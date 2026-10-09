import { Module } from '@nestjs/common';
import { NotificationModule } from '../bitrix24/notification.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ReportScheduler } from './report.scheduler';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '../common/constants';
import { QueuesModule } from '../queues/queues.module';
import { ReportDeliveryService, ReportDeliveryProcessor } from './report-delivery.service';
import { ReportController } from './report.controller';
import { AnalyticsStreamService } from './analytics-stream.service';
import { ReportExportService } from './report-export.service';

@Module({
  imports: [QueuesModule, NotificationModule, BullModule.registerQueue({ name: QUEUES.REPORTS })],
  controllers: [AnalyticsController, ReportController],
  providers: [
    AnalyticsService,
    AnalyticsStreamService,
    ReportExportService,
    ReportScheduler,
    ReportDeliveryService,
    ReportDeliveryProcessor,
  ],
})
export class AnalyticsModule {}
