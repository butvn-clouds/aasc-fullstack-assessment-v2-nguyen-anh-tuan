import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Interval } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { retryAfterMs } from '../common/retry-after';

interface NotificationRow {
  id: string;
  event_key: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private busy = false;
  constructor(
    private readonly config: ConfigService,
    private readonly ds: DataSource,
  ) {}

  async notify(event: string, payload: Record<string, unknown>, manager?: EntityManager, key: string = randomUUID()) {
    await (manager ?? this.ds).query(
      `INSERT INTO notification_outbox(event_key,event,payload) VALUES ($1,$2,$3::jsonb)
       ON CONFLICT(event_key) DO NOTHING`,
      [key, event, JSON.stringify(payload)],
    );
  }

  @Interval(5000)
  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let i = 0; i < 20; i++) {
        const token = randomUUID();
        // Lease được ghi trước khi gửi HTTP, không giữ transaction trong lúc chờ mạng.
        const rows: NotificationRow[] = await this.ds.query(
          `WITH candidate AS (
          SELECT id FROM notification_outbox WHERE status IN ('pending','processing')
          AND next_attempt_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
        ), claimed AS (UPDATE notification_outbox n SET status='processing', lease_token=$1,
          next_attempt_at=NOW()+INTERVAL '60 seconds', attempts=attempts+1
          FROM candidate c WHERE n.id=c.id RETURNING n.*) SELECT * FROM claimed`,
          [token],
        );
        const row = rows[0];
        if (!row) break;
        try {
          const url = this.config.get<string>('NOTIFY_WEBHOOK_URL');
          if (url)
            await axios.post(
              url,
              { ...row.payload, event: row.event, event_id: row.event_key },
              {
                timeout: 5000,
                headers: { 'Idempotency-Key': row.event_key },
              },
            );
          else this.logger.log(`[thông báo demo] ${row.event} ${row.event_key}`);
          await this.ds.query(
            `UPDATE notification_outbox SET status=$3,
            sent_at=CASE WHEN $3='sent' THEN NOW() ELSE NULL END, error=NULL,lease_token=NULL
            WHERE id=$1 AND lease_token=$2`,
            [row.id, token, url ? 'sent' : 'logged'],
          );
        } catch (error: unknown) {
          const delay = axios.isAxiosError(error) ? retryAfterMs(error.response?.headers?.['retry-after']) : undefined;
          await this.ds.query(
            `UPDATE notification_outbox SET
            status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
            next_attempt_at=NOW()+make_interval(secs => $3), error=$4,lease_token=NULL
            WHERE id=$1 AND lease_token=$2`,
            [
              row.id,
              token,
              Math.max(2 ** Math.min(row.attempts, 8), (delay ?? 0) / 1000),
              axios.isAxiosError(error) ? `HTTP ${error.response?.status ?? 'network'}` : 'Gửi thông báo thất bại',
            ],
          );
        }
      }
    } catch {
      this.logger.warn('Outbox thông báo chưa xử lý xong; sẽ thử lại ở chu kỳ sau');
    } finally {
      this.busy = false;
    }
  }
}
