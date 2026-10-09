import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import request from 'supertest';
import { MockLeadFactory } from '../tiktok/mock-lead.factory';
import { signPayload } from '../tiktok/tiktok-signature.guard';
import { LeadsService, UpsertInput } from '../leads/leads.service';
import { BitrixSyncProcessor } from '../bitrix24/bitrix-sync.processor';
import { Bitrix24Client, BitrixHttpError } from '../bitrix24/bitrix24.client';
import { AnalyticsService } from '../analytics/analytics.service';
import { ReportExportService } from '../analytics/report-export.service';
import { TikTokEventsService } from '../tiktok/tiktok-events.service';
import { RecoveryService } from '../queues/recovery.service';
import { QUEUES } from '../common/constants';
import { RedisService } from '../common/redis.service';
import { createServer } from 'http';
import { Workbook } from 'exceljs';
import { Deal, Lead, LeadEvent } from '../database/entities';
import { Bitrix24WebhookService } from '../bitrix24/bitrix24-webhook.service';
import { DealsService } from '../deals/deals.service';
import Redis from 'ioredis';
import axios from 'axios';
import { NotificationService } from '../bitrix24/notification.service';

describe('Kiểm thử tích hợp PostgreSQL và Redis (cơ sở dữ liệu kiểm thử riêng)', () => {
  let app: any;
  let ds: DataSource;
  const factory = new MockLeadFactory();
  const send = (payload: any) => {
    const raw = JSON.stringify(payload),
      ts = Math.floor(Date.now() / 1000);
    return request(app.getHttpServer())
      .post('/webhooks/tiktok/leads')
      .set('Content-Type', 'application/json')
      .set('TikTok-Signature', `t=${ts},s=${signPayload('integration-secret', ts, raw)}`)
      .send(raw);
  };
  async function until<T>(read: () => Promise<T>, good: (value: T) => boolean): Promise<T> {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const value = await read();
      if (good(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Hết thời gian chờ tiến trình xử lý nền');
  }
  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      REDIS_PASSWORD: '',
      DB_POOL_MAX: '10',
      DB_CONNECTION_TIMEOUT_MS: '5000',
      DB_IDLE_TIMEOUT_MS: '30000',
      DB_HOST: '127.0.0.1',
      DB_PORT: '55432',
      DB_USER: 'postgres',
      DB_PASSWORD: 'test',
      DB_NAME: 'integration_test',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '56379',
      BITRIX24_MOCK: 'true',
      MOCK_LEADS_ENABLED: 'false',
      TIKTOK_WEBHOOK_SECRET: 'integration-secret',
      BITRIX24_APP_TOKEN: 'integration-token',
      TIKTOK_EVENTS_API_URL: '',
      TIKTOK_EVENTS_MOCK: 'true',
      TIKTOK_ACCESS_TOKEN: '',
      NOTIFY_WEBHOOK_URL: '',
      ADMIN_API_KEY: '',
      REPORT_WEBHOOK_URL: '',
      REPORT_WEBHOOK_TOKEN: '',
    });
    const { AppDataSource } = await import('../database/data-source');
    await AppDataSource.initialize();
    if (AppDataSource.options.database !== 'integration_test' || (AppDataSource.options as any).port !== 55432)
      throw new Error('Không cho phép tạo lại cơ sở dữ liệu ngoài môi trường kiểm thử');
    await AppDataSource.query('DROP SCHEMA public CASCADE');
    await AppDataSource.query('CREATE SCHEMA public');
    await AppDataSource.runMigrations();
    await AppDataSource.destroy();
    const testRedis = new Redis({ host: '127.0.0.1', port: 56379, maxRetriesPerRequest: 1 });
    try {
      await testRedis.flushdb();
    } finally {
      await testRedis.quit();
    }
    const { AppModule } = await import('../app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ rawBody: true, logger: false });
    await app.listen(0, '127.0.0.1');
    app.get(ConfigService).set('PORT', String(app.getHttpServer().address().port));
    ds = app.get(DataSource);
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
  });

  it('outbox thông báo khôi phục sau lỗi HTTP và hai bộ gửi không nhận cùng bản ghi', async () => {
    await ds.query('DELETE FROM notification_outbox');
    const received: string[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const input = JSON.parse(body);
        received.push(input.event_id);
        res.statusCode = received.length === 1 ? 503 : 200;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const config = app.get(ConfigService) as ConfigService;
    const address = server.address() as { port: number };
    config.set('NOTIFY_WEBHOOK_URL', `http://127.0.0.1:${address.port}`);
    try {
      const first = new NotificationService(config, ds);
      await first.notify('deal.won', { dealId: 'notification-test' }, undefined, 'notification-test');
      await first.drain();
      const [pending] = await ds.query("SELECT * FROM notification_outbox WHERE event_key='notification-test'");
      expect(pending.status).toBe('pending');
      expect(pending.attempts).toBe(1);
      await ds.query("UPDATE notification_outbox SET next_attempt_at=NOW() WHERE event_key='notification-test'");
      await Promise.all([new NotificationService(config, ds).drain(), new NotificationService(config, ds).drain()]);
      const [sent] = await ds.query("SELECT * FROM notification_outbox WHERE event_key='notification-test'");
      expect(sent.status).toBe('sent');
      expect(sent.attempts).toBe(2);
      expect(received).toEqual(['notification-test', 'notification-test']);
    } finally {
      config.set('NOTIFY_WEBHOOK_URL', '');
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('tạo deal và outbox cùng rollback khi ghi thông báo lỗi', async () => {
    const lead = await ds.getRepository(Lead).save({ externalId: 'notification-atomic', name: 'Atomic' });
    const deals = app.get(DealsService) as DealsService;
    const notifications = app.get(NotificationService) as NotificationService;
    await expect(
      deals.create({ leadId: lead.id, title: 'Atomic', bitrixMode: 'mock' }, async (deal, manager) => {
        await notifications.notify('deal.created', { dealId: deal.id }, manager, 'atomic-creation');
        throw new Error('Lỗi sau ghi thông báo');
      }),
    ).rejects.toThrow('Lỗi sau ghi thông báo');
    expect(await ds.getRepository(Deal).countBy({ leadId: lead.id })).toBe(0);
    expect(await ds.query("SELECT id FROM notification_outbox WHERE event_key='atomic-creation'")).toHaveLength(0);
  });

  it('lease hết hạn được phục hồi; không nhận lease còn hiệu lực', async () => {
    const notifications = app.get(NotificationService) as NotificationService;
    await notifications.notify('test.recovery', {}, undefined, 'expired-lease');
    await notifications.notify('test.active', {}, undefined, 'active-lease');
    await ds.query(
      "UPDATE notification_outbox SET status='processing',next_attempt_at=NOW()-INTERVAL '1 minute' WHERE event_key='expired-lease'",
    );
    await ds.query(
      "UPDATE notification_outbox SET status='processing',next_attempt_at=NOW()+INTERVAL '1 minute' WHERE event_key='active-lease'",
    );
    await notifications.drain();
    const rows = await ds.query(
      "SELECT event_key,status FROM notification_outbox WHERE event_key IN ('expired-lease','active-lease') ORDER BY event_key",
    );
    expect(rows).toEqual([
      { event_key: 'active-lease', status: 'processing' },
      { event_key: 'expired-lease', status: 'logged' },
    ]);
    await ds.query("DELETE FROM notification_outbox WHERE event_key IN ('expired-lease','active-lease')");
  });

  it.each(['lead', 'deal'] as const)(
    'CRM HTTP tạo %s xong rồi ngắt kết nối: retry đồng thời không tạo trùng',
    async (kind) => {
      const records: { ID: number; ORIGIN_ID: string }[] = [];
      let creates = 0;
      const server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const input = JSON.parse(body);
          if (req.url?.includes('.list.')) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ result: records.filter((r) => r.ORIGIN_ID === input.filter['=ORIGIN_ID']) }));
          } else {
            creates++;
            records.push({ ID: 123, ORIGIN_ID: input.fields.ORIGIN_ID });
            res.destroy();
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const transport = axios.create({
        baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        timeout: 2000,
      });
      const factory = jest.spyOn(axios, 'create').mockReturnValueOnce(transport);
      const client = new Bitrix24Client(
        new ConfigService({ BITRIX24_MOCK: 'false', BITRIX24_WEBHOOK_URL: 'https://test.invalid/' }),
        ds,
      );
      factory.mockRestore();
      const fields = { ORIGIN_ID: `disconnect-${kind}`, ORIGINATOR_ID: 'integration-test', TITLE: 'Test' };
      const create = () => (kind === 'lead' ? client.addLead(fields) : client.addDeal(fields));
      try {
        const results = await Promise.allSettled([create(), create()]);
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        await expect(create()).resolves.toBe(123);
        expect(creates).toBe(1);
        expect(records).toHaveLength(1);
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    },
  );

  it.each(['weak', 'interested'] as const)('mock %s vẫn đồng bộ lead nhưng không tự tạo deal', async (quality) => {
    const payload = factory.create('[DEMO] Interested', quality);
    await send(payload).expect(202);
    const [lead] = await until(
      () => ds.query('SELECT * FROM leads WHERE external_id=$1', [payload.lead_data.ttclid]),
      (rows) => rows.length === 1 && rows[0].status === 'synced',
    );
    const queue = app.get(getQueueToken(QUEUES.BITRIX_SYNC)) as Queue;
    await until(
      () => queue.getJobCounts('active', 'waiting'),
      (counts) => counts.active === 0 && counts.waiting === 0,
    );
    expect(lead.score).toBe(quality === 'weak' ? 30 : 60);
    expect(lead.bitrix24_id).toBeTruthy();
    expect(await ds.query('SELECT id FROM deals WHERE lead_id=$1', [lead.id])).toHaveLength(0);
  });

  it('xử lý webhook có chữ ký → hàng đợi khách hàng → giao dịch CRM → thông báo thành công → chuyển đổi và xuất báo cáo', async () => {
    const payload = factory.create('[DEMO] Integration Sale', 'qualified');
    await send(payload).expect(202);
    const [deal] = await until(
      () =>
        ds.query(`SELECT d.*,l.email FROM deals d JOIN leads l ON l.id=d.lead_id WHERE l.external_id=$1`, [
          payload.lead_data.ttclid,
        ]),
      (rows) => rows.length === 1,
    );
    expect(Number(deal.amount)).toBeGreaterThan(0);
    const response = await request(app.getHttpServer())
      .post('/mock/bitrix24/deal/update')
      .send({ id: deal.bitrix24_id, fields: { STAGE_ID: 'WON', PROBABILITY: 100, OPPORTUNITY: 18000000 } })
      .expect(201);
    expect(response.body.callback.updated).toBe(true);
    await app.get(TikTokEventsService).drain();
    const [local] = await ds.query('SELECT * FROM deals WHERE id=$1', [deal.id]);
    expect(local.status).toBe('won');
    expect(Number(local.amount)).toBe(18000000);
    const [outbox] = await ds.query('SELECT * FROM conversion_outbox WHERE event_key=$1', [`deal-${deal.id}-won`]);
    expect(outbox.status).toBe('mocked');
    await request(app.getHttpServer())
      .get('/api/v1/reports/export?format=csv&date_range=30d')
      .expect(200)
      .expect('Content-Type', /csv/);
    const analytics = await request(app.getHttpServer()).get('/api/v1/analytics/conversion-rates').expect(200);
    expect(analytics.body.overall.won).toBeGreaterThanOrEqual(1);
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it('rollback deal và outbox khi transaction lỗi; callback đồng thời không tạo trùng conversion và timeline', async () => {
    const lead = await ds.getRepository(Lead).save({ externalId: 'atomic-test', name: 'Kiểm thử transaction' });
    const deal = await ds.getRepository(Deal).save({
      leadId: lead.id,
      bitrix24Id: 900001,
      bitrixMode: 'mock',
      title: 'Kiểm thử transaction',
      stage: 'NEW',
      status: 'open',
      amount: 100,
    });
    const client = app.get(Bitrix24Client) as Bitrix24Client;
    const events = app.get(TikTokEventsService) as TikTokEventsService;
    const service = app.get(Bitrix24WebhookService) as Bitrix24WebhookService;
    const remote = jest.spyOn(client, 'getDeal').mockResolvedValue({ STAGE_ID: 'WON', OPPORTUNITY: '250' });
    const original = events.queueConversion.bind(events);
    const fail = jest.spyOn(events, 'queueConversion').mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('Lỗi sau khi ghi outbox');
    });
    try {
      await expect(service.updateDeal(900001)).rejects.toThrow('Lỗi sau khi ghi outbox');
      expect(await ds.getRepository(Deal).findOneByOrFail({ id: deal.id })).toMatchObject({
        status: 'open',
        amount: 100,
      });
      expect(
        await ds.query('SELECT id FROM conversion_outbox WHERE event_key=$1', [`deal-${deal.id}-won`]),
      ).toHaveLength(0);
      expect(await ds.getRepository(LeadEvent).countBy({ leadId: lead.id })).toBe(0);
      expect(await ds.query("SELECT id FROM notification_outbox WHERE payload->>'dealId'=$1", [deal.id])).toHaveLength(
        0,
      );
      fail.mockRestore();
      await Promise.all([service.updateDeal(900001), service.updateDeal(900001)]);
      expect(await ds.getRepository(Deal).findOneByOrFail({ id: deal.id })).toMatchObject({
        status: 'won',
        amount: 250,
      });
      expect(
        await ds.query('SELECT id FROM conversion_outbox WHERE event_key=$1', [`deal-${deal.id}-won`]),
      ).toHaveLength(1);
      expect(await ds.getRepository(LeadEvent).countBy({ leadId: lead.id, type: 'deal_status' })).toBe(1);
      expect(await ds.query("SELECT id FROM notification_outbox WHERE payload->>'dealId'=$1", [deal.id])).toHaveLength(
        1,
      );
    } finally {
      fail.mockRestore();
      remote.mockRestore();
      await ds.query('DELETE FROM conversion_outbox WHERE event_key=$1', [`deal-${deal.id}-won`]);
      await ds.getRepository(Deal).delete(deal.id);
      await ds.getRepository(LeadEvent).delete({ leadId: lead.id });
      await ds.getRepository(Lead).delete(lead.id);
    }
  });

  it('API từ chối mapping prototype và giữ nguyên cấu hình đã lưu', async () => {
    const before = await request(app.getHttpServer()).get('/api/v1/config/mappings').expect(200);
    for (const target of ['__proto__[reviewProbe]', 'constructor[prototype][reviewProbe]', 'EMAIL[0][__proto__]']) {
      await request(app.getHttpServer())
        .put('/api/v1/config/mappings')
        .send({ field_mapping: { 'lead_data.full_name': target } })
        .expect(400);
    }
    const after = await request(app.getHttpServer()).get('/api/v1/config/mappings').expect(200);
    expect(after.body).toEqual(before.body);
    expect(Object.prototype).not.toHaveProperty('reviewProbe');
  });

  it('conversion thiếu cấu hình thật được giữ để retry, không đánh dấu đã gửi', async () => {
    const config = app.get(ConfigService) as ConfigService;
    const events = app.get(TikTokEventsService) as TikTokEventsService;
    const previous = config.get('TIKTOK_EVENTS_MOCK');
    config.set('TIKTOK_EVENTS_MOCK', 'false');
    try {
      await events.queueConversion('missing-real-config', { event: 'CompletePayment' });
      await events.drain();
      const [row] = await ds.query("SELECT * FROM conversion_outbox WHERE event_key='missing-real-config'");
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(1);
      expect(row.sent_at).toBeNull();
      expect(row.error).toContain('chưa gửi conversion');
    } finally {
      config.set('TIKTOK_EVENTS_MOCK', previous);
      await ds.query("DELETE FROM conversion_outbox WHERE event_key='missing-real-config'");
    }
  });

  it('gộp dữ liệu gửi đồng thời có cùng số điện thoại nhưng khác email', async () => {
    const leads = app.get(LeadsService);
    const input: UpsertInput = {
      externalId: 'concurrency',
      name: 'Test',
      email: null,
      phone: '+84329999999',
      city: 'Hà Nội',
      campaignId: null,
      adId: null,
      formId: null,
      score: 30,
      rawData: {},
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        leads.upsert({ ...input, externalId: `concurrency-${i}`, email: `parallel-${i}@example.com` }),
      ),
    );
    expect(new Set(results.map((r: any) => r.lead.id)).size).toBe(1);
    expect(results.filter((r: any) => r.created)).toHaveLength(1);
    const id = results[0].lead.id;
    await Promise.all(Array.from({ length: 3 }, () => leads.recordInteraction(id, 'user.interact', 'same-event')));
    const [row] = await ds.query('SELECT score FROM leads WHERE id=$1', [id]);
    expect(row.score).toBe(35);
  });

  it('xử lý tuần tự tác vụ đồng bộ và dùng lại mã CRM cho cùng nguồn dữ liệu', async () => {
    const leads = app.get(LeadsService);
    const payload = factory.create('[DEMO] Recovery Sale', 'qualified');
    const { lead } = await leads.upsert({
      externalId: payload.lead_data.ttclid!,
      name: 'Sanitized Name',
      email: 'clean@example.com',
      phone: null,
      city: 'Hà Nội',
      campaignId: payload.campaign.campaign_id,
      adId: null,
      formId: null,
      score: 80,
      rawData: payload,
    });
    const processor = app.get(BitrixSyncProcessor);
    await Promise.all([
      processor.process({ data: { leadId: lead.id } }),
      processor.process({ data: { leadId: lead.id } }),
    ]);
    expect(await ds.query('SELECT id FROM deals WHERE lead_id=$1', [lead.id])).toHaveLength(1);
    const [record] = await ds.query(
      `SELECT fields FROM bitrix_mock_records WHERE kind='lead' AND fields->>'ORIGIN_ID'=$1`,
      [lead.id],
    );
    expect(record.fields.NAME).toBe('Sanitized Name');
    expect(record.fields.EMAIL[0].VALUE).toBe('clean@example.com');
    const client = app.get(Bitrix24Client);
    const ids = await Promise.all([
      client.addDeal({ ORIGIN_ID: 'retry-origin', TITLE: 'Retry' }),
      client.addDeal({ ORIGIN_ID: 'retry-origin', TITLE: 'Retry' }),
    ]);
    expect(ids[0]).toBe(ids[1]);
  });

  it('cho phép cùng Bitrix ID ở mock và CRM thật, lookup theo đúng mode', async () => {
    const lead = await ds.getRepository(Lead).save({ externalId: 'mode-id-collision', name: 'Mode collision' });
    const dealRepo = ds.getRepository(Deal);
    try {
      const mockDeal = await dealRepo.save({
        leadId: lead.id,
        bitrix24Id: 367,
        bitrixMode: 'mock',
        title: 'Mock deal',
      });
      const realDeal = await dealRepo.save({
        leadId: lead.id,
        bitrix24Id: 367,
        bitrixMode: 'real',
        title: 'Real deal',
      });
      const deals = app.get(DealsService) as DealsService;

      await expect(deals.findByLead(lead.id, 'mock')).resolves.toMatchObject({ id: mockDeal.id });
      await expect(deals.findByLead(lead.id, 'real')).resolves.toMatchObject({ id: realDeal.id });
      await expect(deals.findByBitrixId(367, 'mock')).resolves.toMatchObject({ id: mockDeal.id });
      await expect(deals.findByBitrixId(367, 'real')).resolves.toMatchObject({ id: realDeal.id });
    } finally {
      await dealRepo.delete({ leadId: lead.id });
      await ds.getRepository(Lead).delete(lead.id);
    }
  });

  it('khôi phục webhook đã lưu khi thêm vào hàng đợi thất bại', async () => {
    const payload = factory.create('[DEMO] Inbox Sale', 'qualified');
    const queue = app.get(getQueueToken(QUEUES.LEAD_PROCESS)) as Queue;
    const spy = jest.spyOn(queue, 'add').mockRejectedValueOnce(new Error('Giả lập lỗi thêm vào hàng đợi Redis'));
    await send(payload).expect(500);
    spy.mockRestore();
    await ds.query(`UPDATE webhook_events SET created_at=NOW()-INTERVAL '1 minute' WHERE event_id=$1`, [
      payload.event_id,
    ]);
    await app.get(RecoveryService).recover();
    await until(
      () => ds.query('SELECT status FROM webhook_events WHERE event_id=$1', [payload.event_id]),
      (rows) => rows[0]?.status === 'processed',
    );
  });

  it('lưu chuyển đổi gửi thất bại và thử lại một lần mà không tạo trùng bản ghi chờ gửi', async () => {
    const events = app.get(TikTokEventsService);
    await events.queueConversion('integration-retry', { event: 'CompletePayment', value: 99 });
    await events.queueConversion('integration-retry', { event: 'CompletePayment', value: 99 });
    const spy = jest.spyOn(events, 'sendConversion').mockRejectedValueOnce(new Error('Lỗi tạm thời'));
    await events.drain();
    const [failed] = await ds.query("SELECT * FROM conversion_outbox WHERE event_key='integration-retry'");
    expect(failed.status).toBe('pending');
    expect(failed.attempts).toBe(1);
    spy.mockRestore();
    await ds.query("UPDATE conversion_outbox SET next_attempt_at=NOW() WHERE event_key='integration-retry'");
    await events.drain();
    const rows = await ds.query("SELECT * FROM conversion_outbox WHERE event_key='integration-retry'");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('mocked');
  });

  it('xác thực phiên Redis qua HTTP và từ chối mã phiên đã thu hồi hoặc hết hạn', async () => {
    const config = app.get(ConfigService);
    config.set('ADMIN_API_KEY', 'test-admin-key');
    try {
      await request(app.getHttpServer()).get('/api/v1/leads').expect(401);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/sessions')
        .set('X-API-Key', 'test-admin-key')
        .expect(201);
      const token = login.body.accessToken;
      await request(app.getHttpServer())
        .get('/api/v1/auth/sessions/current')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app.getHttpServer()).get('/api/v1/leads').set('Authorization', `Bearer ${token}`).expect(200);
      await request(app.getHttpServer())
        .delete('/api/v1/auth/sessions/current')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app.getHttpServer()).get('/api/v1/leads').set('Authorization', `Bearer ${token}`).expect(401);
      const second = await request(app.getHttpServer())
        .post('/api/v1/auth/sessions')
        .set('X-API-Key', 'test-admin-key')
        .expect(201);
      const redis = app.get(RedisService).client;
      const { createHash } = await import('crypto');
      await redis.expire(`auth:session:${createHash('sha256').update(second.body.accessToken).digest('hex')}`, -1);
      await request(app.getHttpServer())
        .get('/api/v1/leads')
        .set('Authorization', `Bearer ${second.body.accessToken}`)
        .expect(401);
    } finally {
      config.set('ADMIN_API_KEY', '');
    }
  });

  it('xuất tệp Excel đọc được và phản ánh ngay thay đổi đã lưu vào cơ sở dữ liệu', async () => {
    const api = app.getHttpServer();
    const before = await request(api).get('/api/v1/analytics/conversion-rates').expect(200);
    await ds.query(
      `INSERT INTO leads(external_id,name,source,bitrix_mode) VALUES ('fresh-analytics','Fresh analytics','tiktok','mock')`,
    );
    const after = await request(api).get('/api/v1/analytics/conversion-rates').expect(200);
    expect(after.body.overall.leads).toBe(before.body.overall.leads + 1);
    const exported = await request(api)
      .get('/api/v1/reports/export?format=xlsx&date_range=7d')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new Workbook();
    await workbook.xlsx.load(exported.body);
    expect(workbook.worksheets[0].rowCount).toBeGreaterThan(1);
  });

  it('thử lại việc gửi báo cáo qua HTTP và đính kèm tệp Excel thật theo dạng multipart', async () => {
    const received: { id: string | string[] | undefined; body: Buffer }[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        received.push({ id: req.headers['idempotency-key'], body: Buffer.concat(chunks) });
        res.statusCode = received.length === 1 ? 503 : 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const config = app.get(ConfigService);
    config.set('REPORT_WEBHOOK_URL', `http://127.0.0.1:${(server.address() as any).port}/reports`);
    try {
      const queued = await request(app.getHttpServer()).post('/api/v1/reports/deliveries').expect(201);
      await until(
        async () => {
          const response = await request(app.getHttpServer())
            .get(`/api/v1/reports/deliveries/${queued.body.jobId}`)
            .expect(200);
          return response.body.state;
        },
        (state) => state === 'completed',
      );
      expect(received).toHaveLength(2);
      expect(received[0].id).toBe(received[1].id);
      const body = received[1].body;
      const marker = body.indexOf(Buffer.from('PK\x03\x04'));
      expect(marker).toBeGreaterThan(0);
      const end = body.lastIndexOf(Buffer.from('\r\n--'));
      const workbook = new Workbook();
      await workbook.xlsx.load(body.subarray(marker, end) as any);
      expect(workbook.worksheets[0].name).toBe('Khách hàng tiềm năng');
    } finally {
      config.set('REPORT_WEBHOOK_URL', '');
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('phân loại nhập trùng và phục hồi sự kiện đã lưu khi hàng đợi gián đoạn', async () => {
    const payload = factory.create('[DEMO] Import Sale', 'qualified');
    const queue = app.get(getQueueToken(QUEUES.LEAD_PROCESS)) as Queue;
    const spy = jest.spyOn(queue, 'add').mockRejectedValueOnce(new Error('Giả lập lỗi Redis khi nhập'));
    let result;
    try {
      result = await request(app.getHttpServer())
        .post('/api/v1/leads/import')
        .send([payload, payload, { event_id: 'invalid-import' }])
        .expect(202);
    } finally {
      spy.mockRestore();
    }
    expect(result.body).toMatchObject({ queued: 0, skipped: 2, failed: 0, pendingRecovery: 1 });
    expect(result.body.results.map((row: { status: string }) => row.status)).toEqual([
      'pending_recovery',
      'duplicate',
      'invalid',
    ]);
    await ds.query(`UPDATE webhook_events SET created_at=NOW()-INTERVAL '1 minute' WHERE event_id=$1`, [
      payload.event_id,
    ]);
    await app.get(RecoveryService).recover();
    await until(
      () => ds.query('SELECT status FROM webhook_events WHERE event_id=$1', [payload.event_id]),
      (rows) => rows[0]?.status === 'processed',
    );
    await request(app.getHttpServer()).post('/api/v1/leads/import').send({}).expect(400);
  });

  it('từ chối khoảng thời gian sai ở mọi API thống kê và xuất báo cáo', async () => {
    for (const path of [
      'analytics/conversion-rates',
      'analytics/campaign-performance',
      'analytics/stream',
      'reports/export',
    ]) {
      await request(app.getHttpServer()).get(`/api/v1/${path}?date_range=invalid`).expect(400);
      await request(app.getHttpServer()).get(`/api/v1/${path}?date_range=0d`).expect(400);
    }
  });
  it('gộp lead trùng: giữ attribution first-touch, lưu email phụ, dedup theo email phụ và Bitrix24 nhận đủ liên hệ', async () => {
    const first = factory.create('[DEMO] Merge First', 'qualified');
    first.lead_data.email = 'merge-first@example.com';
    first.lead_data.phone = '+84907770001';
    first.lead_data.ttclid = 'TT-MERGE-1';
    await send(first).expect(202);
    const [lead] = await until(
      () => ds.query('SELECT * FROM leads WHERE external_id=$1 AND bitrix24_id IS NOT NULL', ['TT-MERGE-1']),
      (rows) => rows.length === 1,
    );

    const second = factory.create('[DEMO] Merge Second', 'qualified');
    second.lead_data.email = 'merge-second@example.com';
    second.lead_data.phone = '+84907770001';
    second.lead_data.ttclid = 'TT-MERGE-2';
    await send(second).expect(202);
    // lần 3 chỉ trùng email phụ (khác SĐT) vẫn phải gộp vào cùng lead
    const third = factory.create('[DEMO] Merge Third', 'qualified');
    third.lead_data.email = 'merge-second@example.com';
    third.lead_data.phone = '+84907770002';
    third.lead_data.ttclid = 'TT-MERGE-3';
    await until(
      () => ds.query(`SELECT 1 FROM lead_events WHERE lead_id=$1 AND type='merged'`, [lead.id]),
      (rows) => rows.length === 1,
    );
    await send(third).expect(202);

    const merged = await until(
      () => ds.query('SELECT * FROM leads WHERE id=$1', [lead.id]),
      (rows) => rows[0].extra_contacts.phones.includes('+84907770002'),
    );
    expect(merged[0].email).toBe('merge-first@example.com');
    expect(merged[0].extra_contacts.emails).toEqual(['merge-second@example.com']);
    expect(merged[0].raw_data.lead_data.ttclid).toBe('TT-MERGE-1');
    expect(merged[0].raw_data.campaign.campaign_name).toBe(first.campaign.campaign_name);
    const [{ count }] = await ds.query(
      `SELECT COUNT(*)::int AS count FROM leads WHERE email IN ('merge-first@example.com','merge-second@example.com')`,
    );
    expect(count).toBe(1);

    const [crm] = await until(
      () => ds.query(`SELECT fields FROM bitrix_mock_records WHERE kind='lead' AND id=$1`, [lead.bitrix24_id]),
      (rows) => (rows[0]?.fields?.EMAIL?.length ?? 0) >= 2 && (rows[0]?.fields?.PHONE?.length ?? 0) >= 2,
    );
    expect(crm.fields.EMAIL.map((e: any) => e.VALUE)).toEqual(['merge-first@example.com', 'merge-second@example.com']);
    expect(crm.fields.UF_CRM_TTCLID).toBe('TT-MERGE-1');
  });

  it('báo cáo tách mode, không nhân đôi lead có deal mock và real', async () => {
    const campaign = 'report-mode-regression';
    const repo = ds.getRepository(Lead);
    const makeLead = (externalId: string, bitrixMode: 'mock' | 'real' | 'legacy') =>
      repo.save({ externalId, bitrixMode, name: externalId, campaignId: campaign, score: 60 });
    const mock = await makeLead('report-mock', 'mock');
    const real = await makeLead('report-real', 'real');
    const shared = await makeLead('report-shared', 'real');
    await makeLead('report-legacy', 'legacy');
    await makeLead('report-mock-no-deal', 'mock');
    await makeLead('report-real-no-deal', 'real');
    for (const [leadId, mode, amount] of [
      [mock.id, 'mock', 10],
      [real.id, 'real', 20],
      [shared.id, 'mock', 30],
      [shared.id, 'real', 50],
    ] as const) {
      await ds.getRepository(Deal).save({
        leadId,
        bitrixMode: mode,
        title: campaign,
        amount,
        status: 'won',
      });
    }
    const config = app.get(ConfigService);
    try {
      for (const [mode, revenue] of [
        ['true', 40],
        ['false', 70],
      ] as const) {
        config.set('BITRIX24_MOCK', mode);
        const conversion = await request(app.getHttpServer()).get('/api/v1/analytics/conversion-rates').expect(200);
        expect(
          conversion.body.campaigns.find((c: { campaign_id: string }) => c.campaign_id === campaign),
        ).toMatchObject({ leads: 3, deals: 2, won: 2 });
        const snapshot = await (app.get(AnalyticsService) as AnalyticsService).snapshot('30d');
        expect(snapshot.campaigns.find((c) => c.campaign_id === campaign)).toMatchObject({ leads: 3, won: 2, revenue });
        const performance = await request(app.getHttpServer())
          .get('/api/v1/analytics/campaign-performance')
          .expect(200);
        expect(performance.body.find((c: { campaign_id: string }) => c.campaign_id === campaign)).toMatchObject({
          revenue,
        });
        const exported = await request(app.getHttpServer()).get('/api/v1/reports/export?format=json').expect(200);
        const rows = exported.body.filter((r: { campaign_id: string }) => r.campaign_id === campaign);
        expect(rows).toHaveLength(3);
        expect(new Set(rows.map((r: { id: string }) => r.id)).size).toBe(3);
        expect(rows.reduce((sum: number, r: { deal_amount: string }) => sum + Number(r.deal_amount ?? 0), 0)).toBe(
          revenue,
        );
        const file = await (app.get(ReportExportService) as ReportExportService).createXlsx('30d');
        try {
          const workbook = new Workbook();
          await workbook.xlsx.readFile(file.path);
          let count = 0,
            total = 0;
          workbook.worksheets[0].eachRow((row) => {
            if (row.getCell(6).value === campaign) {
              count++;
              total += Number(row.getCell(13).value ?? 0);
            }
          });
          expect(count).toBe(3);
          expect(total).toBe(revenue);
        } finally {
          await file.dispose();
        }
      }
    } finally {
      config.set('BITRIX24_MOCK', 'true');
    }
  });

  it.each(['429', 'database'])('queue thực thử lại lỗi %s rồi đồng bộ thành công', async (kind) => {
    const repo = ds.getRepository(Lead);
    const lead = await repo.save({ externalId: 'retry-' + kind, name: 'Retry', bitrixMode: 'mock' });
    const client = app.get(Bitrix24Client) as Bitrix24Client;
    lead.bitrix24Id = await client.addLead({ ORIGIN_ID: lead.id, ORIGINATOR_ID: 'tiktok-integration', NAME: 'Retry' });
    await repo.save(lead);
    const leads = app.get(LeadsService) as LeadsService;
    const get = leads.getOrFail.bind(leads);
    const update = client.updateLead.bind(client);
    let failures = 0;
    const retryTimes: number[] = [];
    const spy =
      kind === 'database'
        ? jest.spyOn(leads, 'getOrFail').mockImplementation(async (id) => {
            if (id === lead.id && failures++ === 0) throw new Error('DB tạm thời gián đoạn');
            return get(id);
          })
        : jest.spyOn(client, 'updateLead').mockImplementation(async (id, fields) => {
            if (id === lead.bitrix24Id) retryTimes.push(Date.now());
            if (id === lead.bitrix24Id && failures++ === 0)
              throw new BitrixHttpError('crm.lead.update', 429, 'Giới hạn tạm thời', 1000);
            return update(id, fields);
          });
    try {
      const queue = app.get(getQueueToken(QUEUES.BITRIX_SYNC)) as Queue;
      const job = await queue.add('sync', { leadId: lead.id }, { attempts: 2, backoff: { type: 'fixed', delay: 20 } });
      await until(
        () => job.getState(),
        (state) => state === 'completed',
      );
      const done = await queue.getJob(job.id!);
      expect(done!.attemptsMade).toBe(2);
      expect(failures).toBe(2);
      if (kind === '429') expect(retryTimes[1] - retryTimes[0]).toBeGreaterThanOrEqual(950);
    } finally {
      spy.mockRestore();
    }
  });

  it('xuất CSV/JSON qua HTTP đủ 20.000 lead từ PostgreSQL', async () => {
    await ds.query(`INSERT INTO leads(external_id,name,source,bitrix_mode)
      SELECT 'bulk-stream-'||n, 'Bulk scale '||n, 'tiktok', 'mock' FROM generate_series(1,20000) n`);
    try {
      const json = await request(app.getHttpServer())
        .get('/api/v1/reports/export?format=json&date_range=7d')
        .expect(200);
      const rows = json.body.filter((row: { name: string }) => row.name.startsWith('Bulk scale '));
      expect(rows).toHaveLength(20000);
      expect(new Set(rows.map((row: { id: string }) => row.id)).size).toBe(20000);
      const csv = await request(app.getHttpServer()).get('/api/v1/reports/export?format=csv&date_range=7d').expect(200);
      expect(csv.text.match(/Bulk scale /g)).toHaveLength(20000);
    } finally {
      await ds.query("DELETE FROM leads WHERE external_id LIKE 'bulk-stream-%'");
    }
  }, 60000);

  it('giới hạn đăng nhập sai, tách webhook và không giới hạn health', async () => {
    const config = app.get(ConfigService);
    config.set('ADMIN_API_KEY', 'rate-test-key');
    try {
      const health = await request(app.getHttpServer()).get('/health').expect(200);
      expect(health.headers['x-ratelimit-limit']).toBeUndefined();
      const api = await request(app.getHttpServer()).get('/api/v1/leads').expect(401);
      expect(api.headers['x-ratelimit-limit']).toBe('120');
      const tiktok = await request(app.getHttpServer()).post('/webhooks/tiktok/leads').send({}).expect(401);
      expect(tiktok.headers['x-ratelimit-limit']).toBe('600');
      const bitrix = await request(app.getHttpServer())
        .post('/webhooks/bitrix24/deals')
        .send({ event: 'ONCRMDEALUPDATE', auth: { application_token: 'wrong' }, data: { FIELDS: { ID: '1' } } })
        .expect(401);
      expect(bitrix.headers['x-ratelimit-limit']).toBe('600');
      let blocked = false;
      for (let i = 0; i < 11; i++) {
        const response = await request(app.getHttpServer()).post('/api/v1/auth/sessions').set('X-API-Key', 'wrong');
        if (response.status === 429) {
          expect(response.headers['retry-after']).toBeDefined();
          blocked = true;
          break;
        }
        expect(response.status).toBe(401);
        expect(response.headers['x-ratelimit-limit']).toBe('10');
      }
      expect(blocked).toBe(true);
      await request(app.getHttpServer()).get('/health').expect(200);
    } finally {
      config.set('ADMIN_API_KEY', '');
    }
  });
});
