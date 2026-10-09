import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookEvent } from '../database/entities';
import { QueuesModule } from '../queues/queues.module';
import { TikTokEventsService } from './tiktok-events.service';
import { TikTokSignatureGuard } from './tiktok-signature.guard';
import { TikTokWebhookController } from './tiktok-webhook.controller';
import { MockLeadsService } from './mock-leads.service';
import { TikTokDemoController } from './tiktok-demo.controller';
import { WebhookEventsController } from './webhook-events.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookEvent]), QueuesModule],
  controllers: [TikTokWebhookController, TikTokDemoController, WebhookEventsController],
  providers: [TikTokSignatureGuard, TikTokEventsService, MockLeadsService],
  exports: [TikTokEventsService],
})
export class TikTokModule {}
