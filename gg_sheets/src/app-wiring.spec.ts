import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { GoogleSheetsService } from './google-sheets/google-sheets.service';
import { Bitrix24ClientService } from './bitrix24/bitrix24-client.service';
import { SyncSchedulerService } from './sync/sync-scheduler.service';
import { SyncService } from './sync/sync.service';
import { TwoWaySyncService } from './sync/two-way-sync.service';
import { RealtimeSyncService } from './sync/realtime-sync.service';

describe('Module ứng dụng sau hợp nhất', () => {
  it('đăng ký đủ hai chiều và Admin; API quản trị vẫn yêu cầu key', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GoogleSheetsService)
      .useValue({})
      .overrideProvider(Bitrix24ClientService)
      .useValue({})
      .overrideProvider(SyncSchedulerService)
      .useValue({ onModuleInit: () => {} })
      .compile();
    const app = module.createNestApplication();
    try {
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      expect(app.get(SyncService)).toBeDefined();
      expect(app.get(TwoWaySyncService)).toBeDefined();
      expect(app.get(RealtimeSyncService)).toBeDefined();
      expect((await fetch(base + '/admin')).status).toBe(200);
      expect((await fetch(base + '/api/v1/sync/run', { method: 'POST' })).status).toBe(401);
      expect((await fetch(base + '/api/v1/sync/reverse-run', { method: 'POST' })).status).toBe(401);
    } finally {
      await app.close();
    }
  }, 30000);
});
