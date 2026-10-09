import { Bitrix24WebhookService } from './bitrix24-webhook.service';
import { Module } from '@nestjs/common';
import { DealsModule } from '../deals/deals.module';
import { LeadsModule } from '../leads/leads.module';
import { QueuesModule } from '../queues/queues.module';
import { TikTokModule } from '../tiktok/tiktok.module';
import { AssignmentService } from './assignment.service';
import { Bitrix24Client } from './bitrix24.client';
import { Bitrix24WebhookController } from './bitrix24-webhook.controller';
import { BitrixSyncProcessor } from './bitrix-sync.processor';
import { NotificationModule } from './notification.module';
import { MockCrmController, MockOnlyGuard } from './mock-crm.controller';

@Module({
  imports: [LeadsModule, DealsModule, QueuesModule, TikTokModule, NotificationModule],
  controllers: [Bitrix24WebhookController, MockCrmController],
  providers: [Bitrix24WebhookService, Bitrix24Client, BitrixSyncProcessor, AssignmentService, MockOnlyGuard],
})
export class Bitrix24Module {}
