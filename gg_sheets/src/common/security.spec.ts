import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { FailureLimiter } from './failure-limiter.util';
import { ApiKeyGuard } from './guards/api-key.guard';
import { publicError } from './public-error';
import { applySecurity, swaggerEnabled } from './security';

@Controller()
class Probe {
  @Get('ping') ping() {
    return { ok: true };
  }
  @Get('docs/x') docs() {
    return { ok: true };
  }
}
@Module({ controllers: [Probe] })
class ProbeModule {}

describe('HTTP hardening', () => {
  let app: NestExpressApplication;
  let base: string;
  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(ProbeModule, { logger: false });
    applySecurity(app, {});
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(() => app.close());

  it('sends strict security headers and hides the framework', async () => {
    const res = await fetch(base + '/ping');
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('content-security-policy')).not.toContain('upgrade-insecure-requests');
  });
  it('relaxes CSP only for the Swagger path', async () => {
    const res = await fetch(base + '/docs/x');
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('disables Swagger by default in production, allows an explicit override', () => {
    expect(swaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(swaggerEnabled({ NODE_ENV: 'production', ENABLE_SWAGGER: 'true' })).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'development', ENABLE_SWAGGER: 'false' })).toBe(false);
  });
});

describe('FailureLimiter', () => {
  it('blocks after N failures inside the window and recovers afterwards', () => {
    let t = 0;
    const limiter = new FailureLimiter(3, 1000, 100, () => t);
    for (let i = 0; i < 3; i++) limiter.fail('ip');
    expect(limiter.isBlocked('ip')).toBe(true);
    expect(limiter.isBlocked('other')).toBe(false);
    expect(limiter.retryAfterSeconds('ip')).toBe(1);
    t = 1500;
    expect(limiter.isBlocked('ip')).toBe(false);
  });
  it('is bounded in memory', () => {
    const limiter = new FailureLimiter(3, 60_000, 5);
    for (let i = 0; i < 50; i++) limiter.fail('ip' + i);
    expect((limiter as any).hits.size).toBeLessThanOrEqual(5);
  });
});

describe('ApiKeyGuard brute-force protection', () => {
  const guard = new ApiKeyGuard({ get: () => 'a-very-long-random-admin-key-123' } as any);
  const ctx = (key: string, ip: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ ip, header: () => key }) }),
    }) as any;
  it('locks an IP with 429 after repeated wrong keys, even if it then sends the right one', () => {
    for (let i = 0; i < 10; i++) expect(() => guard.canActivate(ctx('wrong', '9.9.9.9'))).toThrow();
    let status = 0;
    try {
      guard.canActivate(ctx('a-very-long-random-admin-key-123', '9.9.9.9'));
    } catch (e: any) {
      status = e.getStatus();
    }
    expect(status).toBe(429);
    // IP khác không bị ảnh hưởng
    expect(guard.canActivate(ctx('a-very-long-random-admin-key-123', '8.8.8.8'))).toBe(true);
  });
});

describe('publicError', () => {
  it('explains a busy sync lock clearly instead of a generic failure', () => {
    const out = publicError(new Error('SYNC_LOCKED: đang có tiến trình đồng bộ khác'));
    expect(out.code).toBe('SYNC_LOCKED');
    expect(out.message).toContain('Chờ');
  });
});
