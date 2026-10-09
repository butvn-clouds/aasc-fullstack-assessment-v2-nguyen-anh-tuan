import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { SyncService } from './sync.service';
import { TwoWaySyncService } from './two-way-sync.service';

/** Đăng ký lịch cron từ biến SYNC_CRON (mặc định mỗi 15 phút).
 * SchedulerRegistry cho phép lấy lịch từ cấu hình thay vì sửa decorator @Cron trong mã. */
@Injectable()
export class SyncSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SyncSchedulerService.name);
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly syncService: SyncService,
    @Optional() private readonly reverse?: TwoWaySyncService,
  ) {}

  onModuleInit(): void {
    const direction = this.configService.get('SYNC_DIRECTION', 'forward');
    if (!['forward', 'reverse', 'both'].includes(direction))
      throw new Error('SYNC_DIRECTION phải là forward, reverse hoặc both');
    const cronExpression = this.configService.get<string>(
      'SYNC_CRON',
      this.configService.get<string>('SYNC_CRON_EXPRESSION', '*/15 * * * *'),
    );
    const job = new CronJob(cronExpression, () => this.runIfNotAlreadyRunning());
    this.schedulerRegistry.addCronJob('sheets-bitrix-sync', job);
    job.start();
    this.logger.log(`Đã đăng ký tác vụ đồng bộ theo lịch cron "${cronExpression}"`);
  }

  /** Ngăn chạy chồng khi lần đồng bộ trước chưa xong, chẳng hạn Sheet lớn hoặc API chậm. */
  private async runIfNotAlreadyRunning(): Promise<void> {
    if (this.running) {
      this.logger.warn('Lần đồng bộ trước chưa xong, bỏ qua lượt chạy theo lịch này');
      return;
    }
    this.running = true;
    try {
      const direction = this.configService.get('SYNC_DIRECTION', 'forward');
      if (direction === 'reverse' || direction === 'both') {
        if (!this.reverse) throw new Error('Chưa khởi tạo service đồng bộ ngược');
        await this.reverse.run();
      }
      if (direction === 'forward' || direction === 'both') await this.syncService.run();
    } catch (error) {
      this.logger.error(`Đồng bộ theo lịch thất bại: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
