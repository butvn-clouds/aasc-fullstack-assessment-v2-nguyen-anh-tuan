import { Test } from '@nestjs/testing';
import { AdminController } from '../admin/admin.controller';
import { ConfigService } from '@nestjs/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BitrixWebhookController } from './bitrix-webhook.controller';
import { RealtimeSyncService } from './realtime-sync.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { TwoWaySyncService } from './two-way-sync.service';
import { MappingConfigService } from '../config/mapping-config.service';

/** Kiểm tra phân tích nội dung HTTP và xác thực mà không kết nối Google hoặc CRM. */
describe('admin and Bitrix webhook HTTP contract', () => {
  let app: INestApplication;
  let base: string;
  const realtime = { enqueue: jest.fn().mockReturnValue({ queued: true, pending: 1 }) };
  const mapping = { get: () => ({ columns: {} }), update: jest.fn().mockImplementation((v) => v) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BitrixWebhookController, SyncController, AdminController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'BITRIX24_WEBHOOK_SECRET' ? 'event-secret' : 'admin-secret',
          },
        },
        { provide: RealtimeSyncService, useValue: realtime },
        { provide: SyncService, useValue: { run: () => ({ created: 0 }) } },
        { provide: TwoWaySyncService, useValue: { run: () => ({ pulledDown: 0 }) } },
        { provide: MappingConfigService, useValue: mapping },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('accepts a native Bitrix form event with application token', async () => {
    const body = new URLSearchParams({
      event: 'ONCRMLEADUPDATE',
      'data[FIELDS][ID]': '123',
      'auth[application_token]': 'event-secret',
    });
    const response = await fetch(base + '/webhooks/bitrix24/leads', { method: 'POST', body });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, queued: true });
    expect(realtime.enqueue).toHaveBeenCalledWith('123');
  });
  it('rejects unauthenticated events before any processing', async () => {
    realtime.enqueue.mockClear();
    const response = await fetch(base + '/webhooks/bitrix24/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leadId: 123 }),
    });
    expect(response.status).toBe(401);
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });
  it('keeps the admin shell public and all data/write endpoints protected', async () => {
    const page = await fetch(base + '/admin');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('/api/v1/sync/admin/assets/admin.js');
    const unauthorized = await fetch(base + '/api/v1/sync/admin');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('content-type')).toContain('application/json');
    const connection = await fetch(base + '/api/v1/sync/admin', {
      headers: { 'x-api-key': 'admin-secret' },
    });
    expect(connection.status).toBe(200);
    expect(connection.headers.get('content-type')).toContain('application/json');
    expect(await connection.json()).toEqual({ authenticated: true });
    expect(
      (
        await fetch(base + '/api/v1/sync/admin', {
          headers: { 'x-api-key': 'invalid' },
        })
      ).status,
    ).toBe(401);
    for (const [file, type] of [
      ['admin.css', 'text/css'],
      ['admin.js', 'application/javascript'],
    ]) {
      const asset = await fetch(base + '/api/v1/sync/admin/assets/' + file);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain(type);
      expect(asset.headers.get('x-content-type-options')).toBe('nosniff');
      expect((await asset.text()).length).toBeGreaterThan(100);
    }
    expect((await fetch(base + '/api/v1/sync/admin/assets/missing.js')).status).toBe(404);
    for (const [path, method] of [
      ['admin/config', 'GET'],
      ['admin/config', 'PUT'],
      ['run', 'POST'],
      ['reverse-run', 'POST'],
    ]) {
      expect((await fetch(base + '/api/v1/sync/' + path, { method })).status).toBe(401);
    }
    expect(
      (
        await fetch(base + '/api/v1/sync/admin/config', {
          headers: { 'x-api-key': 'admin-secret' },
        })
      ).status,
    ).toBe(200);
    const response = await fetch(base + '/api/v1/sync/admin/config', {
      method: 'PUT',
      headers: { 'x-api-key': 'admin-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ columns: { Email: 'EMAIL' } }),
    });
    expect(response.status).toBe(200);
    expect(mapping.update).toHaveBeenCalledWith({ columns: { Email: 'EMAIL' } });
  });
});
