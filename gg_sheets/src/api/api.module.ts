import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { SyncController } from '../sync/sync.controller';
import { AdminController } from '../admin/admin.controller';
import { BitrixWebhookController } from '../sync/bitrix-webhook.controller';

@Module({
  imports: [SyncModule],
  controllers: [SyncController, AdminController, BitrixWebhookController],
})
export class ApiModule {}
