import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { NotificationService } from '../bitrix24/notification.service';
import { AnalyticsService } from './analytics.service';
import { ReportDeliveryService } from './report-delivery.service';

@Injectable()
export class ReportScheduler {
  private readonly logger = new Logger(ReportScheduler.name);
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly notifier: NotificationService,
    private readonly config: ConfigService,
    private readonly delivery: ReportDeliveryService,
  ) {}

  // Bù lịch sau khi khởi động lại hoặc Redis tạm gián đoạn, một lần mỗi ngày theo giờ Bangkok.
  @Cron('*/5 * * * *', { timeZone: 'Asia/Bangkok' })
  async ensureReport() {
    if (!this.delivery.enabled()) return;
    const now = new Date();
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hourCycle: 'h23' }).format(now),
    );
    if (hour < 8) return;
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    await this.delivery.enqueue(date);
  }

  @Cron('0 8 * * *', { timeZone: 'Asia/Bangkok' })
  async daily() {
    const r = await this.analytics.conversionRates('7d');
    this.logger.log(`Báo cáo hằng ngày: ${JSON.stringify(r.overall)}`);
    const min = Number(this.config.get('REPORT_ALERT_MIN_CONVERSION', 0.05));
    if (r.overall.leads >= 20 && r.overall.lead_to_deal < min) {
      await this.notifier.notify('alert.low_conversion', { lead_to_deal: r.overall.lead_to_deal, threshold: min });
    }
  }
}
