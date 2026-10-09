import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SyncModule } from '../sync/sync.module';
import { SyncSchedulerService } from '../sync/sync-scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), SyncModule],
  providers: [SyncSchedulerService],
})
export class AppSchedulerModule {}
