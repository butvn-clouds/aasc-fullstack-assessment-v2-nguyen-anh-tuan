import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomInt } from 'crypto';
import axios from 'axios';
import { MockLeadFactory } from './mock-lead.factory';
import { signPayload } from './tiktok-signature.guard';

@Injectable()
export class MockLeadsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MockLeadsService.name);
  private readonly abort = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private intervalMs = 0;
  private remaining = 0;
  private secret = '';
  private readonly factory = new MockLeadFactory();

  constructor(private readonly config: ConfigService) {}

  onApplicationBootstrap() {
    if (String(this.config.get('MOCK_LEADS_ENABLED', 'false')) !== 'true') return;
    const realCrm = String(this.config.get('BITRIX24_MOCK', 'false')).toLowerCase() !== 'true';
    if (realCrm && String(this.config.get('MOCK_LEADS_ALLOW_REAL_CRM', 'false')).toLowerCase() !== 'true') {
      throw new Error(
        'MOCK_LEADS_ENABLED với Bitrix24 thật cần xác nhận MOCK_LEADS_ALLOW_REAL_CRM=true (lead [DEMO] sẽ vào CRM thật)',
      );
    }
    const minutes = Number(this.config.get('MOCK_LEADS_INTERVAL_MINUTES', 15));
    const max = Number(this.config.get('MOCK_LEADS_MAX_TOTAL', 1000));
    if (!Number.isFinite(minutes) || minutes < 0.5 || minutes > 1440) {
      throw new Error('MOCK_LEADS_INTERVAL_MINUTES phải nằm trong khoảng 0.5–1440');
    }
    if (!Number.isSafeInteger(max) || max < 1 || max > 100000) {
      throw new Error('MOCK_LEADS_MAX_TOTAL phải là số nguyên từ 1 đến 100000');
    }
    this.secret = this.config.get<string>('TIKTOK_WEBHOOK_SECRET', '');
    const remoteTarget = this.config.get<string>('MOCK_TIKTOK_TARGET_URL');
    if (remoteTarget && !this.secret) throw new Error('Giả lập từ xa cần dùng chung TIKTOK_WEBHOOK_SECRET');
    if (!remoteTarget && (!this.secret || this.secret === 'change-me')) {
      this.secret = randomBytes(32).toString('hex');
      this.config.set('TIKTOK_WEBHOOK_SECRET', this.secret);
      this.logger.log('TikTok giả lập: đã tạo khóa bí mật webhook tạm thời cho lần chạy này');
    }
    this.intervalMs = minutes * 60000;
    this.remaining = max;
    this.schedule();
    this.logger.log(
      `Đã bật dữ liệu giả lập: 5–10 khách hàng tiềm năng mỗi ${minutes} phút, tối đa ${max} mỗi lần chạy`,
    );
  }

  onModuleDestroy() {
    clearTimeout(this.timer);
    this.abort.abort();
  }

  private schedule() {
    if (this.abort.signal.aborted || this.remaining <= 0) return;
    this.timer = setTimeout(() => {
      void this.generateBatch();
    }, this.intervalMs);
    this.timer.unref();
  }

  private async generateBatch() {
    const count = Math.min(randomInt(5, 11), this.remaining);
    let accepted = 0;
    try {
      for (let i = 0; i < count && !this.abort.signal.aborted; i++) {
        const payload = this.factory.create();
        const timestamp = payload.timestamp;
        const body = JSON.stringify(payload);
        const signature = signPayload(this.secret, timestamp, body);
        await axios.post(
          this.config.get(
            'MOCK_TIKTOK_TARGET_URL',
            `http://127.0.0.1:${this.config.get('PORT', 3000)}/webhooks/tiktok/leads`,
          ),
          body,
          {
            headers: { 'Content-Type': 'application/json', 'TikTok-Signature': `t=${timestamp},s=${signature}` },
            timeout: 10000,
            signal: this.abort.signal,
          },
        );
        this.remaining--;
        accepted++;
      }
      this.logger.log(`Đợt giả lập: đã nhận ${accepted} sự kiện; còn lại ${this.remaining}`);
    } catch {
      if (!this.abort.signal.aborted)
        this.logger.warn(`Đợt giả lập bị gián đoạn sau ${accepted} sự kiện; sẽ thử lại vào chu kỳ sau`);
    } finally {
      this.schedule();
    }
  }
}
