import { Injectable, Logger, Optional, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { publicError } from '../common/public-error';
import { TwoWaySyncService } from './two-way-sync.service';

/** Số Lead ID chờ tối đa; vượt ngưỡng thì gộp thành MỘT lượt kéo toàn bộ thay vì lưu thêm từng ID. */
const MAX_PENDING = 500;
const MAX_ATTEMPTS = 3;

/** Webhook và tác vụ kéo dữ liệu theo lịch dùng chung cách xử lý xung đột và khóa tiến trình.
 *
 * Webhook Bitrix24 chỉ được ACK nhanh (202); việc kéo dữ liệu chạy nền qua hàng đợi:
 * - Nhiều sự kiện đến dồn được GỘP: trùng ID chỉ xử lý một lần, nhiều ID khác nhau gộp thành một
 *   lượt kéo toàn Sheet (một lần đọc Sheet thay vì N lần).
 * - Lỗi tạm thời (khóa bận, timeout, quota) được thử lại tối đa MAX_ATTEMPTS với backoff tăng dần.
 * Hàng đợi nằm trong bộ nhớ: nếu process chết, sự kiện chưa xử lý được bù bởi lịch đồng bộ ngược. */
@Injectable()
export class RealtimeSyncService {
  private readonly logger = new Logger(RealtimeSyncService.name);
  private readonly pending = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private fullPass = false;
  private draining?: Promise<void>;
  private readonly retryDelayMs: number;

  constructor(
    private readonly reverse: TwoWaySyncService,
    @Optional() config?: ConfigService,
  ) {
    this.retryDelayMs = Number(config?.get('WEBHOOK_RETRY_DELAY_MS', 2000) ?? 2000);
  }

  enqueue(leadId: string): { queued: true; pending: number } {
    if (this.pending.size >= MAX_PENDING) this.fullPass = true;
    else this.pending.add(leadId);
    this.draining ??= this.drain().finally(() => {
      this.draining = undefined;
    });
    return { queued: true, pending: this.pending.size + (this.fullPass ? 1 : 0) };
  }

  /** Chờ hàng đợi rỗng (dùng khi tắt ứng dụng và trong test). */
  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.idle();
  }

  private async drain(): Promise<void> {
    await Promise.resolve(); // nhường event loop để phản hồi HTTP được gửi trước khi bắt đầu việc nặng
    while (this.pending.size || this.fullPass) {
      const ids = [...this.pending];
      const full = this.fullPass;
      this.pending.clear();
      this.fullPass = false;
      try {
        await this.runReverse(ids.length === 1 && !full ? ids[0] : undefined);
        ids.forEach((id) => this.attempts.delete(id));
      } catch (error) {
        const detail = publicError(error);
        const requeued: string[] = [];
        for (const id of ids) {
          const tried = (this.attempts.get(id) ?? 0) + 1;
          if (tried < MAX_ATTEMPTS) {
            this.attempts.set(id, tried);
            this.pending.add(id);
            requeued.push(id);
          } else {
            this.attempts.delete(id);
            this.logger.error(`Bỏ sự kiện lead ${id} sau ${tried} lần thất bại: ${detail.code}`);
          }
        }
        if (full) this.fullPass = true;
        this.logger.warn(
          `Webhook chưa xử lý được (${detail.code}); thử lại ${requeued.length || (full ? 1 : 0)} mục`,
        );
        if (this.retryDelayMs > 0)
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryDelayMs * Math.max(1, ...this.attempts.values())),
          );
        if (!requeued.length && !full) continue;
      }
    }
  }

  private async runReverse(leadId?: string) {
    const result = await this.reverse.run(leadId);
    if (result.errors)
      throw new UnprocessableEntityException(
        'Webhook đã nhận nhưng chưa cập nhật được Sheet. Kiểm tra dữ liệu Lead và lịch sử đồng bộ.',
      );
    return result;
  }

  async syncLeadFromWebhook(leadId: string) {
    const result = await this.runReverse(leadId);
    return { ...result, updated: result.pulledDown > 0 };
  }
}
