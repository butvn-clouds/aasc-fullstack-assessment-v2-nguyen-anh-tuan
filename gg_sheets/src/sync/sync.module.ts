import { Module } from '@nestjs/common';
import { ConnectionCheckService } from './connection-check.service';
import { Bitrix24Module } from '../bitrix24/bitrix24.module';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';
import { MappingConfigModule } from '../config/mapping-config.module';
import { SyncService } from './sync.service';
import { TwoWaySyncService } from './two-way-sync.service';
import { RealtimeSyncService } from './realtime-sync.service';
import { SyncHistoryService } from './sync-history.service';
import { CrmPreflightService } from './crm-preflight.service';
import { CreateJournalService } from './create-journal.service';

@Module({
  imports: [GoogleSheetsModule, Bitrix24Module, MappingConfigModule],
  providers: [
    CrmPreflightService,
    CreateJournalService,
    SyncService,
    TwoWaySyncService,
    RealtimeSyncService,
    SyncHistoryService,
    ConnectionCheckService,
  ],
  exports: [
    SyncService,
    TwoWaySyncService,
    RealtimeSyncService,
    SyncHistoryService,
    ConnectionCheckService,
  ],
})
export class SyncModule {}
