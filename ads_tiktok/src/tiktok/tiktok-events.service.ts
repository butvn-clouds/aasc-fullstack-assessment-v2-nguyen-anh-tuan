import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Interval } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';

/** Conversion giả lập phải được bật rõ ràng; thiếu cấu hình thật không được coi là gửi thành công. */
@Injectable()
export class TikTokEventsService {
  private readonly logger = new Logger(TikTokEventsService.name);
  private busy = false;
  constructor(
    private readonly config: ConfigService,
    private readonly ds: DataSource,
  ) {}

  async queueConversion(eventKey: string, payload: Record<string, unknown>, manager?: EntityManager) {
    await (manager ?? this.ds).query(
      `INSERT INTO conversion_outbox(event_key,payload) VALUES ($1,$2::jsonb)
      ON CONFLICT(event_key) DO NOTHING`,
      [eventKey, JSON.stringify({ ...payload, event_id: eventKey })],
    );
  }

  @Interval(5000)
  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let i = 0; i < 20; i++) {
        const worked = await this.ds.transaction(async (m) => {
          const [row] = await m.query(`SELECT * FROM conversion_outbox WHERE status='pending'
            AND next_attempt_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
          if (!row) return false;
          try {
            const result = await this.sendConversion(row.payload);
            if (result.mock) {
              await m.query(`UPDATE conversion_outbox SET status='mocked', sent_at=NULL, error=NULL WHERE id=$1`, [
                row.id,
              ]);
            } else {
              await m.query(`UPDATE conversion_outbox SET status='sent', sent_at=NOW(), error=NULL WHERE id=$1`, [
                row.id,
              ]);
            }
          } catch (error) {
            await m.query(
              `UPDATE conversion_outbox SET attempts=attempts+1,
              status=CASE WHEN attempts+1>=5 THEN 'failed' ELSE 'pending' END,
              next_attempt_at=NOW()+make_interval(secs => $2), error=$3 WHERE id=$1`,
              [row.id, Math.min(300, 2 ** (row.attempts + 1)), (error as Error).message],
            );
          }
          return true;
        });
        if (!worked) break;
      }
    } catch (error) {
      this.logger.warn(`Hàng đợi chuyển đổi sẽ thử lại: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  async sendConversion(input: {
    event_id?: string;
    ttclid?: string;
    event: string;
    value?: number | null;
    currency?: string;
    email?: string | null;
    phone?: string | null;
  }) {
    if (String(this.config.get('TIKTOK_EVENTS_MOCK', 'false')).toLowerCase() === 'true') {
      this.logger.log(`[giả lập] Chuyển đổi TikTok ${JSON.stringify(input)}`);
      return { mock: true };
    }
    const url = this.config.get<string>('TIKTOK_EVENTS_API_URL')?.trim();
    const token = this.config.get<string>('TIKTOK_ACCESS_TOKEN')?.trim();
    if (!url || !token) throw new Error('Thiếu TIKTOK_EVENTS_API_URL hoặc TIKTOK_ACCESS_TOKEN; chưa gửi conversion');
    let endpoint: URL;
    try {
      endpoint = new URL(url);
    } catch {
      throw new Error('TIKTOK_EVENTS_API_URL không hợp lệ');
    }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password)
      throw new Error('TIKTOK_EVENTS_API_URL phải là HTTPS và không chứa thông tin đăng nhập');
    const res = await axios.post(
      url,
      {
        event_id: input.event_id,
        event: input.event,
        timestamp: new Date().toISOString(),
        context: { ad: { callback: input.ttclid } },
        properties: { value: input.value, currency: input.currency ?? 'VND' },
      },
      { headers: { 'Access-Token': token }, timeout: 10000 },
    );
    if (res.data?.code != null && Number(res.data.code) !== 0)
      throw new Error(`Lỗi API sự kiện TikTok: ${res.data.code}`);
    return { ...res.data, mock: false };
  }
}
