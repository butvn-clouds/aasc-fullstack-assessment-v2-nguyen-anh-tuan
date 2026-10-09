import { ConfigService } from '@nestjs/config';
import { TikTokDemoController } from './tiktok-demo.controller';
import { TikTokSignatureGuard } from './tiktok-signature.guard';
import { signSwaggerDemoRequest } from './swagger-demo';

describe('Swagger TikTok demo signing', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    delete (global as any).window;
  });

  it('turns the empty Swagger body into a valid signed request without sharing the secret', async () => {
    const config = new ConfigService({ BITRIX24_MOCK: 'true', TIKTOK_WEBHOOK_SECRET: 'test-shared-secret' });
    const controller = new TikTokDemoController(config);
    (global as any).window = { location: { href: 'http://localhost:3000/docs' } };
    global.fetch = jest.fn(async (_url, options) => ({
      ok: true,
      json: async () => controller.prepare(JSON.parse(options!.body as string)),
    })) as any;
    // Test the instrumented function directly; compiled standalone form is checked during export.
    const interceptor = signSwaggerDemoRequest;
    const req = await interceptor({
      url: 'http://localhost:3000/webhooks/tiktok/leads',
      method: 'POST',
      body: '{}',
      headers: {},
    });
    expect(JSON.parse(req.body!).event).toBe('lead.generate');
    const guard = new TikTokSignatureGuard(config);
    expect(
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            rawBody: Buffer.from(req.body!),
            headers: { 'tiktok-signature': req.headers['TikTok-Signature'] },
          }),
        }),
      } as any),
    ).toBe(true);
    expect(req.body).not.toContain('test-shared-secret');
  });

  it('enables TikTok signing for a real CRM only when TikTok demo input is enabled', () => {
    const disabled = new ConfigService({ BITRIX24_MOCK: 'false', MOCK_LEADS_ENABLED: 'false' });
    expect(() => new TikTokDemoController(disabled).prepare({})).toThrow();

    const enabled = new ConfigService({
      BITRIX24_MOCK: 'false',
      MOCK_LEADS_ENABLED: 'true',
      TIKTOK_WEBHOOK_SECRET: 'test-shared-secret',
    });
    expect(new TikTokDemoController(enabled).prepare({})).toMatchObject({
      signature: expect.stringMatching(/^t=\d+,s=[a-f0-9]{64}$/),
    });
  });

  it('preserves supplied signatures so invalid signatures are still rejected by the webhook', async () => {
    (global as any).window = { location: { href: 'http://localhost:3000/docs' } };
    global.fetch = jest.fn();
    const req = {
      url: 'http://localhost:3000/webhooks/tiktok/leads',
      method: 'POST',
      body: '{}',
      headers: { 'TikTok-Signature': 'invalid' },
    };
    expect(await signSwaggerDemoRequest(req)).toBe(req);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
