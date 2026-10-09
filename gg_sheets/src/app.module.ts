import { Module } from '@nestjs/common';
import { ApiModule } from './api/api.module';
import { AppConfigModule } from './config/config.module';
import { AppSchedulerModule } from './scheduler/scheduler.module';
import { SyncModule } from './sync/sync.module';
import { APP_FILTER } from '@nestjs/core';
import { SyncErrorFilter } from './common/sync-error.filter';

@Module({
  imports: [AppConfigModule, SyncModule, AppSchedulerModule, ApiModule],
  providers: [{ provide: APP_FILTER, useClass: SyncErrorFilter }],
})
export class AppModule {}
