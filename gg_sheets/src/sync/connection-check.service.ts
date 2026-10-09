import { Injectable, Optional } from '@nestjs/common';
import { CrmPreflightService } from './crm-preflight.service';
import { ConfigService } from '@nestjs/config';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { Bitrix24ClientService } from '../bitrix24/bitrix24-client.service';
import { publicError } from '../common/public-error';
import { randomBytes } from 'crypto';
import { SyncHistoryService } from './sync-history.service';

@Injectable()
export class ConnectionCheckService {
  constructor(
    private readonly config: ConfigService,
    private readonly sheets: GoogleSheetsService,
    private readonly bitrix: Bitrix24ClientService,
    @Optional() private readonly preflight?: CrmPreflightService,
    @Optional() private readonly history?: SyncHistoryService,
  ) {}
  async check() {
    const probe = async (work: () => Promise<unknown>) => {
      const started = Date.now();
      try {
        await work();
        return {
          ok: true,
          latencyMs: Date.now() - started,
          message: `API phản hồi thành công (${Date.now() - started} ms).`,
        };
      } catch (error) {
        return { ok: false, ...publicError(error) };
      }
    };
    const [google, bitrix] = await Promise.all([
      probe(() => this.sheets.checkConnection()),
      probe(async () => {
        await this.preflight?.assertClassic();
        await this.bitrix.call('crm.lead.list', { select: ['ID'], filter: { ID: '0' } }, 0);
      }),
    ]);
    let receiverUrl: string | null = null;
    try {
      const url = new URL(this.config.get<string>('PUBLIC_BASE_URL', ''));
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      )
        receiverUrl = new URL('/webhooks/bitrix24/leads', url.origin).toString();
    } catch {
      /* Địa chỉ chưa được cấu hình hợp lệ. */
    }
    const token = this.config.get<string>('BITRIX24_WEBHOOK_SECRET');
    let receiver = { ok: false, message: 'Thiếu địa chỉ HTTPS hoặc mã xác thực webhook nhận.' };
    if (receiverUrl && token) {
      const challenge = randomBytes(16).toString('hex');
      const started = Date.now();
      try {
        const response = await fetch(receiverUrl, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            'Content-Type': 'application/json',
            'x-bitrix-webhook-secret': token,
            'ngrok-skip-browser-warning': '1',
          },
          body: JSON.stringify({ event: 'SYNC_CONNECTION_PROBE', probe: challenge }),
        });
        if (response.status !== 202)
          receiver.message = `Điểm nhận webhook trả về HTTP ${response.status}. Hãy kiểm tra mã xác thực, địa chỉ và phiên bản ứng dụng.`;
        else {
          const body = await response.json();
          receiver =
            body.probe === challenge && body.receiver === 'bitrix-leads'
              ? {
                  ok: true,
                  message: `Đã gọi qua địa chỉ công khai, xác thực và nhận phản hồi chính xác (${Date.now() - started} ms).`,
                }
              : {
                  ok: false,
                  message:
                    'Địa chỉ có phản hồi nhưng không đúng điểm nhận kiểm tra. Hãy triển khai phiên bản ứng dụng mới.',
                };
        }
      } catch {
        receiver.message =
          'Không gọi được webhook trong 10 giây hoặc kết nối gặp lỗi/chuyển hướng. Hãy kiểm tra đường hầm công khai và PUBLIC_BASE_URL.';
      }
    }
    const history = this.history?.list();
    const last = history?.runs.find((run) => run.direction === 'webhook');
    const updated = last?.summary?.pulledDown ?? last?.summary?.updated ?? 0;
    const evidence = last
      ? `Lần xử lý webhook gần nhất: ${last.startedAt}; trạng thái=${last.status}; cập nhật ${updated} dòng; bỏ qua ${last.summary?.skipped ?? 0}; lỗi ${last.summary?.errors ?? 0}.${last.error ? ' ' + last.error.message : ''}`
      : 'Chưa có lần xử lý webhook nào trong lịch sử hiện tại.';
    return {
      checkedAt: new Date().toISOString(),
      google,
      bitrix,
      webhook: {
        receiverUrl,
        tokenConfigured: !!this.config.get('BITRIX24_WEBHOOK_SECRET'),
        receiver,
        lastRun: last ?? null,
        message: `${receiver.message}\n${evidence}${history?.persistenceError ? '\nKhông thể đọc hoặc lưu đầy đủ lịch sử.' : ''}`,
      },
      strategy: this.config.get('CONFLICT_RESOLUTION_STRATEGY', 'bitrix_wins'),
    };
  }
}
