import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { withRetry, retryWithBackoff } from '../common/retry.util';
import { RateLimiter } from '../common/rate-limiter.util';
import { buildQueryString } from '../common/query-string.util';

export interface Bitrix24Response<T = unknown> {
  result: T;
  time?: Record<string, unknown>;
  error?: string;
  error_description?: string;
}

export interface CrmLead {
  ID: string;
  DATE_MODIFY?: string;
  [key: string]: unknown;
}

@Injectable()
export class Bitrix24ClientService {
  private readonly logger = new Logger(Bitrix24ClientService.name);
  private readonly baseUrl: string;
  private readonly limiter = new RateLimiter(2, 1000);

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.getOrThrow<string>('BITRIX24_WEBHOOK_URL');
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    retries = Number(this.configService.get('SYNC_MAX_RETRIES', 4)),
  ): Promise<T> {
    return withRetry(
      async () => {
        await this.limiter.acquire();
        const url = `${this.baseUrl.replace(/\/$/, '')}/${method}.json`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(30000),
        });
        let body: Bitrix24Response<T>;
        try {
          body = (await response.json()) as Bitrix24Response<T>;
        } catch {
          throw new Bitrix24ApiError(
            'INVALID_RESPONSE',
            'CRM trả phản hồi không phải JSON',
            response.status,
          );
        }

        if (!response.ok || body.error) {
          this.logger.error(
            `Lời gọi Bitrix24 ${method} thất bại: ${body.error} ${body.error_description ?? ''}`,
          );
          throw new Bitrix24ApiError(
            body.error ?? 'UNKNOWN',
            body.error_description ?? response.statusText,
            response.status,
          );
        }
        return body.result;
      },
      retries,
      Number(this.configService.get('SYNC_RETRY_BASE_DELAY_MS', 500)),
    );
  }

  createLead(fields: Record<string, unknown>) {
    return this.call<number>('crm.lead.add', { fields }, 0);
  }

  /** Duyệt toàn bộ lead theo ID tăng dần; không chỉ lấy 50 bản ghi đầu tiên. */
  async getAllLeads(fields: string[]): Promise<CrmLead[]> {
    const leads: CrmLead[] = [];
    const seen = new Set<string>();
    for (let start = 0; ; start += 50) {
      const page = await this.call<CrmLead[]>('crm.lead.list', {
        order: { ID: 'ASC' },
        select: Array.from(new Set(['ID', 'DATE_MODIFY', ...fields])),
        start,
      });
      if (!Array.isArray(page)) throw new Error('Bitrix24 trả danh sách lead không hợp lệ');
      for (const lead of page) {
        const id = String(lead.ID);
        if (seen.has(id))
          throw new Error('Danh sách CRM thay đổi trong khi phân trang; hãy thử lại');
        seen.add(id);
        leads.push({ ...lead, ID: id });
      }
      if (page.length < 50) return leads;
    }
  }

  updateLead(id: number, fields: Record<string, unknown>) {
    return this.call<boolean>('crm.lead.update', { id, fields });
  }

  /** Tìm lead trùng theo email HOẶC số điện thoại bằng crm.duplicate.findbycomm.
   * Không dùng bộ lọc %FIELD của crm.lead.list vì đó là tìm chuỗi con,
   * có thể gộp nhầm các lead không liên quan. EMAIL/PHONE là trường nhiều giá trị;
   * phương thức chuyên dụng so sánh toàn bộ giá trị, bỏ qua số máy lẻ. */
  async findLeadByEmailOrPhone(email?: string, phone?: string): Promise<{ ID: string } | null> {
    const ids = new Set<string>();
    if (email) {
      const id = await this.findDuplicateLeadId('EMAIL', email);
      if (id) ids.add(id);
    }
    if (phone) {
      const id = await this.findDuplicateLeadId('PHONE', phone);
      if (id) ids.add(id);
    }
    if (ids.size > 1)
      throw new Error('Email và điện thoại thuộc các Lead khác nhau; cần đối chiếu thủ công');
    return ids.size ? { ID: [...ids][0] } : null;
  }

  private async findDuplicateLeadId(
    type: 'EMAIL' | 'PHONE',
    value: string,
  ): Promise<string | null> {
    const result = await this.call<{ LEAD?: string[] }>('crm.duplicate.findbycomm', {
      entity_type: 'LEAD',
      type,
      values: [value],
    });
    const ids = [...new Set((result.LEAD ?? []).map(String))];
    if (ids.some((id) => !/^[1-9]\d*$/.test(id))) throw new Error('CRM trả Lead ID không hợp lệ');
    if (ids.length > 1) throw new Error('Một liên hệ khớp nhiều Lead; cần đối chiếu thủ công');
    return ids[0] ?? null;
  }

  /** Lấy nhiều lead theo ID trong một lần gọi để đồng bộ ngược.
   * Bộ lọc @ID tương đương IN, tránh gọi crm.lead.get riêng cho từng lead. */
  async getLeadsByIds(
    ids: string[],
    fields: string[] = [],
  ): Promise<
    Array<{
      ID: string;
      STATUS_ID?: string;
      ASSIGNED_BY_ID?: string;
      DATE_MODIFY?: string;
      [key: string]: unknown;
    }>
  > {
    if (ids.length === 0) return [];
    const leads: CrmLead[] = [];
    const unique = [...new Set(ids)];
    for (let index = 0; index < unique.length; index += 50) {
      const page = await this.call<CrmLead[]>('crm.lead.list', {
        filter: { '@ID': unique.slice(index, index + 50) },
        select: Array.from(
          new Set(['ID', 'STATUS_ID', 'ASSIGNED_BY_ID', 'DATE_MODIFY', ...fields]),
        ),
      });
      if (!Array.isArray(page)) throw new Error('CRM trả danh sách không hợp lệ');
      leads.push(...page);
    }
    return leads;
  }

  /** Phương thức batch nhận tối đa 50 lệnh mỗi lần gọi, giảm số lượt truy vấn trùng lặp. */
  async batch(commands: Record<string, string>): Promise<Record<string, unknown>> {
    return this.call('batch', { halt: 0, cmd: commands });
  }

  /** Dùng batch nhưng trả cấu trúc bên trong gồm {result, result_error},
   * thay vì chỉ .result như call(). Bên gọi cần result_error để xác định từng lệnh lỗi.
   * SyncService nhóm tối đa 50 lệnh tạo/cập nhật trong một yêu cầu HTTP. */
  async batchWrite(
    commands: Record<string, string>,
  ): Promise<{ result: Record<string, unknown>; result_error?: Record<string, unknown> }> {
    if (Object.keys(commands).length > 50) throw new Error('Batch chỉ nhận tối đa 50 lệnh');
    if (!Object.keys(commands).length) return { result: {} };
    // Lệnh tạo hết thời gian chờ có thể đã được ghi. Không tự gửi lại cả lô ghi.
    // Đánh dấu dòng lỗi; lần chạy tiếp theo kiểm tra trùng trước khi tạo lại.
    const result: Record<string, unknown> = {};
    const errors: Record<string, unknown> = {};
    let pending = { ...commands };
    // Chỉ retry lệnh được CRM xác nhận từ chối vì quota. Thành công và timeout
    // không được replay: crm.lead.add không có khóa idempotency phía API.
    await retryWithBackoff(
      async () => {
        const response = await this.call<{
          result: Record<string, unknown>;
          result_error?: Record<string, { error?: string }>;
        }>('batch', { halt: 0, cmd: pending }, 0);
        const retry: Record<string, string> = {};
        for (const key of Object.keys(pending)) {
          const error = response.result_error?.[key];
          if (error) {
            errors[key] = error;
            if (error.error === 'QUERY_LIMIT_EXCEEDED') retry[key] = pending[key];
          } else if (response.result?.[key] !== undefined) {
            result[key] = response.result[key];
            delete errors[key];
          } else {
            errors[key] = {
              error: 'MISSING_RESULT',
              error_description: 'CRM không trả kết quả lệnh',
            };
          }
        }
        pending = retry;
        if (Object.keys(pending).length)
          throw new Bitrix24ApiError('BATCH_QUOTA', 'Lệnh con bị giới hạn');
      },
      {
        maxRetries: Number(this.configService.get('SYNC_MAX_RETRIES', 4)),
        baseDelayMs: Number(this.configService.get('SYNC_RETRY_BASE_DELAY_MS', 500)),
        isRetryable: (error) => error?.code === 'BATCH_QUOTA',
      },
    ).catch((error) => {
      if (error?.code === 'BATCH_QUOTA') return;
      // Giữ các thành công đã nhận ở vòng trước nếu vòng retry mất kết nối.
      if (!Object.keys(result).length) throw error;
      for (const key of Object.keys(pending))
        errors[key] = {
          error: 'UNCERTAIN_WRITE',
          error_description: 'Mất phản hồi CRM; đối chiếu trước khi thử lại',
        };
    });
    return { result, result_error: errors };
  }

  buildCommand(method: string, params: Record<string, unknown>): string {
    return `${method}?${buildQueryString(params)}`;
  }
}

export class Bitrix24ApiError extends Error {
  constructor(
    public readonly code: string,
    description: string,
    public readonly status?: number,
  ) {
    super(`[${code}] ${description}`);
  }
}
