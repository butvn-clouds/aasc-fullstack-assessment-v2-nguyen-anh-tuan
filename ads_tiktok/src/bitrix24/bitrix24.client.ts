import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { DataSource } from 'typeorm';
import { isRecord } from '../common/object';
import { BitrixDeal, BitrixResponse, MockRecord } from './bitrix.dto';
import { retryAfterMs } from '../common/retry-after';

export class BitrixHttpError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    detail: string,
    readonly retryAfterMs?: number,
  ) {
    super(`Bitrix24 ${method} HTTP ${status}: ${detail}`);
    this.name = 'BitrixHttpError';
  }
}

@Injectable()
export class Bitrix24Client {
  private readonly logger = new Logger(Bitrix24Client.name);
  private readonly http?: AxiosInstance;
  private readonly mock: boolean;
  readonly mode: 'mock' | 'real';

  constructor(
    config: ConfigService,
    private readonly ds: DataSource,
  ) {
    this.mock = config.get<string>('BITRIX24_MOCK', 'false').toLowerCase() === 'true';
    this.mode = this.mock ? 'mock' : 'real';
    if (this.mock) {
      this.logger.warn('Đã bật Bitrix24 giả lập; dữ liệu và mã CRM được lưu trong PostgreSQL.');
      return;
    }
    const baseURL = config.get<string>('BITRIX24_WEBHOOK_URL');
    if (!baseURL || !baseURL.startsWith('https://')) {
      throw new Error('Cần cấu hình BITRIX24_WEBHOOK_URL bằng địa chỉ HTTPS thật của Bitrix24.');
    }
    this.http = axios.create({ baseURL, timeout: 10000 });
  }

  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const started = Date.now();
    if (this.mock) return this.mockCall<T>(method, params);
    let res;
    try {
      res = await this.http!.post<BitrixResponse<T>>(`${method}.json`, params);
    } catch (error: unknown) {
      if (!axios.isAxiosError(error) || !error.response) throw error;
      const body = error.response.data;
      const code = isRecord(body) && typeof body.error === 'string' ? body.error : undefined;
      const description =
        isRecord(body) && typeof body.error_description === 'string' ? body.error_description : undefined;
      const detail = [code, description].filter(Boolean).join(': ') || error.message;
      throw new BitrixHttpError(
        method,
        error.response.status,
        detail,
        retryAfterMs(error.response.headers?.['retry-after']),
      );
    }
    this.logger.debug(`${method} ${Date.now() - started}ms`);
    if (res.data?.error) throw new Error(`Bitrix24 ${method}: ${res.data.error} ${res.data.error_description ?? ''}`);
    return res.data.result as T;
  }

  async addLead(fields: Record<string, unknown>) {
    return this.withOriginLock('lead', fields, async () => {
      const existing = await this.findRemoteOrigin('lead', fields);
      if (existing) return existing;
      return this.call<number>('crm.lead.add', {
        fields,
        params: { REGISTER_SONET_EVENT: 'Y' },
      });
    });
  }
  updateLead(id: number, fields: Record<string, unknown>) {
    return this.call<boolean>('crm.lead.update', { id, fields });
  }
  updateDeal(id: number, fields: Record<string, unknown>) {
    return this.call<boolean>('crm.deal.update', { id, fields });
  }
  async addDeal(fields: Record<string, unknown>) {
    return this.withOriginLock('deal', fields, async () => {
      const existing = await this.findRemoteOrigin('deal', fields);
      if (existing) return existing;
      if (!this.mock && fields.CURRENCY_ID != null) {
        const currency = String(fields.CURRENCY_ID);
        const currencies = await this.call<{ CURRENCY: string }[]>('crm.currency.list', {});
        if (!Array.isArray(currencies)) throw new Error('Bitrix24 trả danh sách tiền tệ không hợp lệ');
        if (!currencies.some((item) => item.CURRENCY === currency)) {
          throw new BitrixHttpError(
            'crm.deal.add',
            400,
            `Portal chưa bật tiền tệ ${currency}. Các mã hiện có: ${currencies.map((item) => item.CURRENCY).join(', ')}. ` +
              `Hãy bổ sung ${currency} trong cấu hình tiền tệ Bitrix24 rồi gửi lại tác vụ; không tự đổi đơn vị của số tiền.`,
          );
        }
      }
      return this.call<number>('crm.deal.add', { fields });
    });
  }
  /** Serialize the remote check/create across all workers sharing PostgreSQL.
   * The lock must cover BOTH crm.*.list and crm.*.add; an application-local mutex
   * cannot protect multiple Docker replicas. This does not protect against an
   * unrelated integration writing directly to the same Bitrix24 portal.
   */
  private async withOriginLock<T>(
    kind: 'lead' | 'deal',
    fields: Record<string, unknown>,
    work: () => Promise<T>,
  ): Promise<T> {
    if (this.mock || !fields.ORIGIN_ID || !fields.ORIGINATOR_ID) return work();
    const runner = this.ds.createQueryRunner();
    await runner.connect();
    const key = `bitrix-origin:${kind}:${String(fields.ORIGINATOR_ID)}:${String(fields.ORIGIN_ID)}`;
    let acquired = false;
    try {
      await runner.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key]);
      acquired = true;
      return await work();
    } finally {
      try {
        if (acquired) await runner.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
      } finally {
        await runner.release();
      }
    }
  }

  private async findRemoteOrigin(kind: string, fields: Record<string, unknown>): Promise<number | null> {
    if (this.mock || !fields.ORIGIN_ID) return null;
    const rows = await this.call<{ ID: number | string }[]>(`crm.${kind}.list`, {
      filter: { '=ORIGIN_ID': fields.ORIGIN_ID, '=ORIGINATOR_ID': fields.ORIGINATOR_ID },
      select: ['ID'],
    });
    return rows?.length ? Number(rows[0].ID) : null;
  }
  getDeal(id: number) {
    return this.call<BitrixDeal>('crm.deal.get', { id });
  }

  private async mockCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.logger.log(`[giả lập] ${method} ${JSON.stringify(params)}`);
    switch (method) {
      case 'crm.lead.add':
      case 'crm.deal.add': {
        const kind = method === 'crm.lead.add' ? 'lead' : 'deal';
        const [row] = await this.ds.query(
          `INSERT INTO bitrix_mock_records (kind, fields) VALUES ($1, $2::jsonb)
          ON CONFLICT (kind, (fields->>'ORIGIN_ID')) WHERE fields->>'ORIGIN_ID' IS NOT NULL
          DO UPDATE SET fields=bitrix_mock_records.fields || EXCLUDED.fields RETURNING id`,
          [kind, JSON.stringify(params.fields ?? {})],
        );
        return row.id as T;
      }
      case 'crm.lead.update': {
        const id = Number(params.id);
        // Khôi phục khách hàng giả lập cũ từ bản ghi nội bộ sau khi nâng cấp hoặc khởi động lại.
        await this.ds.query(
          `INSERT INTO bitrix_mock_records (id, kind, fields)
          SELECT $1, 'lead', jsonb_build_object('NAME', name)
          FROM leads WHERE bitrix24_id = $1 AND bitrix_mode = 'mock' ORDER BY created_at DESC LIMIT 1
          ON CONFLICT (id) DO NOTHING`,
          [id],
        );
        const rows = await this.ds.query(
          `WITH updated AS (UPDATE bitrix_mock_records SET fields = fields || $2::jsonb
          WHERE id = $1 AND kind = 'lead' RETURNING id) SELECT id FROM updated`,
          [id, JSON.stringify(params.fields ?? {})],
        );
        if (!rows.length)
          throw new Error(`Bitrix24 giả lập crm.lead.update: không tìm thấy khách hàng tiềm năng ${id}`);
        return true as T;
      }
      case 'crm.deal.get': {
        const id = Number(params.id);
        const [record] = await this.ds.query(`SELECT fields FROM bitrix_mock_records WHERE id = $1 AND kind = 'deal'`, [
          id,
        ]);
        // Giao dịch giả lập cũ có thể trùng mã số với khách hàng; giữ riêng nhánh khôi phục.
        const [legacy] = record
          ? []
          : await this.ds.query(
              `SELECT jsonb_build_object(
          'TITLE', title, 'STAGE_ID', stage, 'CATEGORY_ID', pipeline_id,
          'PROBABILITY', probability, 'OPPORTUNITY', amount, 'CURRENCY_ID', currency,
          'ASSIGNED_BY_ID', assigned_to) AS fields FROM deals WHERE bitrix24_id = $1 AND bitrix_mode = 'mock'`,
              [id],
            );
        const deal = record?.fields ?? legacy?.fields;
        if (!deal) throw new Error(`Bitrix24 giả lập crm.deal.get: không tìm thấy giao dịch ${id}`);
        return { ...deal, ID: id } as T;
      }
      default: {
        const match = /^crm\.(lead|deal)\.(get|list|update|delete)$/.exec(method);
        if (!match) throw new Error(`Bitrix24 giả lập chưa hỗ trợ ${method}`);
        const [, kind, action] = match;
        const id = Number(params.id);
        if (action === 'list') {
          const start = Math.max(0, Number(params.start) || 0);
          const rows = await this.ds.query<MockRecord[]>(
            'SELECT id,fields FROM bitrix_mock_records WHERE kind=$1 ORDER BY id LIMIT 50 OFFSET $2',
            [kind, start],
          );
          return rows.map((r) => ({ ...r.fields, ID: r.id })) as T;
        }
        if (action === 'get') {
          const [row] = await this.ds.query('SELECT fields FROM bitrix_mock_records WHERE kind=$1 AND id=$2', [
            kind,
            id,
          ]);
          if (!row) throw new Error(`Bitrix24 giả lập ${method}: không tìm thấy ${kind} ${id}`);
          return { ...row.fields, ID: id } as T;
        }
        const rows =
          action === 'delete'
            ? await this.ds.query(
                'WITH changed AS (DELETE FROM bitrix_mock_records WHERE kind=$1 AND id=$2 RETURNING id) SELECT id FROM changed',
                [kind, id],
              )
            : await this.ds.query(
                'WITH changed AS (UPDATE bitrix_mock_records SET fields=fields || $3::jsonb WHERE kind=$1 AND id=$2 RETURNING id) SELECT id FROM changed',
                [kind, id, JSON.stringify(params.fields ?? {})],
              );
        if (!rows.length) throw new Error(`Bitrix24 giả lập ${method}: không tìm thấy ${kind} ${id}`);
        return true as T;
      }
    }
  }
}
