import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { SyncModule } from '../sync/sync.module';

/** CLI không khởi động HTTP hoặc cron, tránh chạy đồng bộ ngoài yêu cầu. */
@Module({ imports: [AppConfigModule, SyncModule] })
export class CliAppModule {}
