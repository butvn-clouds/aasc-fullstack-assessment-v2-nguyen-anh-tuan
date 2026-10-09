import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import axios from 'axios';
import { MockLeadsService } from './mock-leads.service';
import { TikTokSignatureGuard } from './tiktok-signature.guard';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TikTokLeadPayloadDto } from './tiktok-payload.dto';
import { normalizePhone } from '../common/normalize';
import { buildBitrixFields } from '../common/bitrix-mapper';
import { DEFAULT_MAPPING } from '../config/configuration';

jest.mock('axios', () => ({ post: jest.fn() }));

describe('MockLeadsService', () => {
  let service: MockLeadsService;
  let config: ConfigService;
  const post = axios.post as jest.Mock;
  function setup(overrides: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      MOCK_LEADS_ENABLED: 'true',
      BITRIX24_MOCK: 'true',
      TIKTOK_WEBHOOK_SECRET: 'test-secret',
      ...overrides,
    };
    config = {
      get: (key: string, fallback: unknown) => values[key] ?? fallback,
      getOrThrow: (key: string) => values[key],
      set: (key: string, value: unknown) => {
        values[key] = value;
      },
    } as ConfigService;
    service = new MockLeadsService(config);
    service.onApplicationBootstrap();
  }
  beforeEach(() => {
    jest.useFakeTimers();
    post.mockReset().mockResolvedValue({ status: 202 });
  });
  afterEach(() => {
    service?.onModuleDestroy();
    jest.useRealTimers();
  });

  it('is disabled by default', async () => {
    setup({ MOCK_LEADS_ENABLED: 'false', BITRIX24_MOCK: 'false' });
    await jest.advanceTimersByTimeAsync(900000);
    expect(post).not.toHaveBeenCalled();
  });

  it('sends signed TikTok demo leads through the webhook when the real CRM is enabled', async () => {
    setup({
      BITRIX24_MOCK: 'false',
      MOCK_LEADS_ALLOW_REAL_CRM: 'true',
      MOCK_LEADS_INTERVAL_MINUTES: '0.5',
      MOCK_LEADS_MAX_TOTAL: '1',
    });

    await jest.advanceTimersByTimeAsync(30000);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('http://127.0.0.1:3000/webhooks/tiktok/leads');
    expect(JSON.parse(post.mock.calls[0][1]).mock).toBe(true);
  });

  it('refuses to start against the real CRM without MOCK_LEADS_ALLOW_REAL_CRM=true', () => {
    expect(() => setup({ BITRIX24_MOCK: 'false' })).toThrow('MOCK_LEADS_ALLOW_REAL_CRM=true');
  });

  it('waits 15 minutes and submits 5–10 unique signed demo events', async () => {
    setup();
    await jest.advanceTimersByTimeAsync(899999);
    expect(post).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(post.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(post.mock.calls.length).toBeLessThanOrEqual(10);
    const emails = new Set<string>();
    const phones = new Set<string>();
    for (const [url, body, options] of post.mock.calls) {
      const payload = JSON.parse(body);
      expect(url).toBe('http://127.0.0.1:3000/webhooks/tiktok/leads');
      expect(payload.mock).toBe(true);
      expect(payload.lead_data.full_name).toMatch(/^\[DEMO\]/);
      emails.add(payload.lead_data.email);
      if (payload.lead_data.phone) {
        expect(phones.has(payload.lead_data.phone)).toBe(false);
        phones.add(payload.lead_data.phone);
      }
      expect(normalizePhone(payload.lead_data.phone)).toBe(payload.lead_data.phone ?? null);
      expect(await validate(plainToInstance(TikTokLeadPayloadDto, payload))).toEqual([]);
      expect(payload.advertiser_id).toBeTruthy();
      expect(payload.lead_data.interests).toHaveLength(2);
      expect(payload.custom_questions.length).toBeGreaterThanOrEqual(1);
      expect(payload.custom_questions.length).toBeLessThanOrEqual(3);
      const fields = buildBitrixFields(DEFAULT_MAPPING, payload);
      if (payload.lead_data.phone)
        expect(fields.PHONE).toEqual([expect.objectContaining({ VALUE: payload.lead_data.phone })]);
      else expect(fields.PHONE).toBeUndefined();
      expect(fields.UF_CRM_AD_NAME).toBe(payload.campaign.ad_name);
      expect(fields.UF_CRM_UTM_CAMPAIGN).toBe(payload.campaign.campaign_name);
      const signature = createHmac('sha256', 'test-secret').update(`${payload.timestamp}.${body}`).digest('hex');
      expect(options.headers['TikTok-Signature']).toBe(`t=${payload.timestamp},s=${signature}`);
    }
    expect(emails.size).toBe(post.mock.calls.length);
  });

  it('respects the cap and stops scheduling', async () => {
    setup({ MOCK_LEADS_INTERVAL_MINUTES: '0.5', MOCK_LEADS_MAX_TOTAL: '7' });
    await jest.advanceTimersByTimeAsync(120000);
    expect(post).toHaveBeenCalledTimes(7);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('recovers on the next interval after failure and clears timers on shutdown', async () => {
    post.mockRejectedValueOnce(new Error('offline'));
    setup({ MOCK_LEADS_INTERVAL_MINUTES: '0.5', MOCK_LEADS_MAX_TOTAL: '1' });
    await jest.advanceTimersByTimeAsync(30000);
    expect(post).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30000);
    expect(post).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60000);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('cancels pending and in-flight work on shutdown', async () => {
    setup();
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(900000);
    expect(post).not.toHaveBeenCalled();
    setup({ MOCK_LEADS_INTERVAL_MINUTES: '0.5' });
    post.mockImplementationOnce(
      (_url, _body, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await jest.advanceTimersByTimeAsync(30000);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    { MOCK_LEADS_INTERVAL_MINUTES: 'NaN' },
    { MOCK_LEADS_INTERVAL_MINUTES: '0' },
    { MOCK_LEADS_MAX_TOTAL: '1.5' },
  ])('rejects invalid settings %j', (settings) => {
    expect(() => setup(settings)).toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['', 'change-me'])('generates a shared secret when configured as %j', async (secret) => {
    setup({ TIKTOK_WEBHOOK_SECRET: secret, MOCK_LEADS_MAX_TOTAL: '1' });
    const generated = config.get<string>('TIKTOK_WEBHOOK_SECRET');
    expect(generated).toMatch(/^[a-f0-9]{64}$/);
    await jest.advanceTimersByTimeAsync(900000);
    const [, body, options] = post.mock.calls[0];
    const guard = new TikTokSignatureGuard(config);
    const context = (signature: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            rawBody: Buffer.from(body),
            headers: { 'tiktok-signature': signature },
          }),
        }),
      }) as any;
    expect(guard.canActivate(context(options.headers['TikTok-Signature']))).toBe(true);
    expect(() => guard.canActivate(context(`t=${JSON.parse(body).timestamp},s=${'0'.repeat(64)}`))).toThrow(
      'Chữ ký không hợp lệ',
    );
  });
});
