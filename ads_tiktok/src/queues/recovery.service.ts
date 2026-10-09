import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { JOB_OPTIONS, QUEUES } from '../common/constants';

/** Sự kiện webhook được lưu bền vững; nếu mất lần đưa vào hàng đợi thì thử lại bằng cùng mã tác vụ. */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);
  private busy = false;
  constructor(
    private readonly ds: DataSource,
    @InjectQueue(QUEUES.LEAD_PROCESS) private readonly queue: Queue,
  ) {}

  @Interval(10000)
  async recover() {
    if (this.busy) return;
    this.busy = true;
    try {
      const rows = await this.ds.query(`SELECT id, event_id FROM webhook_events
        WHERE status='received' AND created_at < NOW() - INTERVAL '5 seconds'
        ORDER BY created_at LIMIT 100`);
      for (const row of rows)
        await this.queue.add('process', { webhookEventId: row.id }, { ...JOB_OPTIONS, jobId: row.id });
    } catch (error) {
      this.logger.warn(`Khôi phục sự kiện đầu vào sẽ thử lại: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
