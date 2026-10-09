import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';

import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { QUEUES } from '../common/constants';
import { WebhookEvent } from '../database/entities';
import { signPayload, TikTokSignatureGuard } from './tiktok-signature.guard';
import { TikTokWebhookController } from './tiktok-webhook.controller';

describe('TikTok webhook HTTP', () => {
  const secret = 'test-secret';
  const event = { id: 'stored-1', eventId: 'evt-http-1' } as WebhookEvent;
  const events = {
    create: jest.fn((value) => value),
    save: jest.fn().mockResolvedValue(event),
  };
  const queue = { add: jest.fn().mockResolvedValue({}) };
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TikTokWebhookController],
      providers: [
        TikTokSignatureGuard,
        {
          provide: ConfigService,
          useValue: { get: (_key: string, fallback: unknown) => fallback, getOrThrow: () => secret },
        },
        { provide: getRepositoryToken(WebhookEvent), useValue: events },
        { provide: getQueueToken(QUEUES.LEAD_PROCESS), useValue: queue },
      ],
    }).compile();

    app = module.createNestApplication({ rawBody: true });
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    events.save.mockResolvedValue(event);
  });

  const postSigned = (body: string, timestamp = Math.floor(Date.now() / 1000)) =>
    request(app.getHttpServer())
      .post('/webhooks/tiktok/leads')
      .set('Content-Type', 'application/json')
      .set('TikTok-Signature', `t=${timestamp},s=${signPayload(secret, timestamp, body)}`)
      .send(body);

  it('xác thực raw body, lưu event và trả HTTP 202', async () => {
    const payload = JSON.stringify({ event: 'lead.generate', event_id: 'evt-http-1' });

    const response = await postSigned(payload);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true, id: event.id });
    expect(events.save).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('từ chối chữ ký sai trước khi ghi event', async () => {
    const payload = JSON.stringify({ event: 'lead.generate', event_id: 'evt-http-1' });

    const response = await request(app.getHttpServer())
      .post('/webhooks/tiktok/leads')
      .set('Content-Type', 'application/json')
      .set('TikTok-Signature', `t=${Math.floor(Date.now() / 1000)},s=${'0'.repeat(64)}`)
      .send(payload);

    expect(response.status).toBe(401);
    expect(events.save).not.toHaveBeenCalled();
  });

  it('trả 400 nếu chữ ký hợp lệ nhưng payload thiếu event_id', async () => {
    const response = await postSigned(JSON.stringify({ event: 'lead.generate' }));

    expect(response.status).toBe(400);
    expect(events.save).not.toHaveBeenCalled();
  });

  it('trả 202 cho event trùng mà không enqueue lại', async () => {
    events.save.mockRejectedValueOnce({ code: '23505' });

    const response = await postSigned(JSON.stringify({ event: 'lead.generate', event_id: 'evt-http-1' }));

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true, duplicate: true });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
