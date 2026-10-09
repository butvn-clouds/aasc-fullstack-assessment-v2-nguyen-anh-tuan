import { ConfigService } from '@nestjs/config';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { AdminKeyGuard } from '../common/admin-key.guard';

describe('Redis admin sessions', () => {
  const values = new Map<string, string>();
  let config: Record<string, string>;
  const redis = {
    client: {
      set: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      get: jest.fn(async (key: string) => values.get(key) ?? null),
      del: jest.fn(async (key: string) => values.delete(key)),
    },
  };
  let service: SessionService;
  let controller: SessionController;
  let settings: ConfigService;
  beforeEach(() => {
    values.clear();
    jest.clearAllMocks();
    config = { ADMIN_API_KEY: 'admin-secret', SESSION_TTL_SECONDS: '120' };
    settings = { get: (key: string, fallback?: unknown) => config[key] ?? fallback } as any;
    service = new SessionService(redis as any, settings);
    controller = new SessionController(service);
  });
  it('stores only a hash-keyed token with TTL and revokes logout immediately', async () => {
    const session = await controller.create('admin-secret');
    expect(session.accessToken).toMatch(/^[a-f0-9]{64}$/);
    expect(redis.client.set.mock.calls[0]).toEqual([
      expect.not.stringContaining(session.accessToken),
      expect.any(String),
      'EX',
      120,
    ]);
    expect([...values.values()].join()).not.toContain('admin-secret');
    expect(await controller.current(`Bearer ${session.accessToken}`)).toMatchObject({ role: 'admin' });
    await controller.logout(`Bearer ${session.accessToken}`);
    await expect(controller.current(`Bearer ${session.accessToken}`)).rejects.toThrow('Phiên đăng nhập đã hết hạn');
  });
  it('rejects malformed, expired, unknown and rotated sessions', async () => {
    expect(await service.validate('bad')).toBeNull();
    expect(await service.validate('a'.repeat(64))).toBeNull();
    await expect(controller.current()).rejects.toThrow('Cần cung cấp mã phiên đăng nhập Bearer');
    const session = await service.create('admin-secret');
    const [key, raw] = [...values.entries()][0];
    values.set(key, JSON.stringify({ ...JSON.parse(raw), expiresAt: '2000-01-01T00:00:00Z' }));
    expect(await service.validate(session.accessToken)).toBeNull();
    values.set(key, raw);
    config.ADMIN_API_KEY = 'rotated';
    expect(await service.validate(session.accessToken)).toBeNull();
    config.ADMIN_API_KEY = '';
    expect(await service.validate(session.accessToken)).toBeNull();
  });
  it('requires an explicit secret and validates credentials even in open demo mode', async () => {
    await expect(service.create('wrong')).rejects.toThrow('Khóa API không hợp lệ');
    await expect(controller.create()).rejects.toThrow('Khóa API không hợp lệ');
    config.ADMIN_API_KEY = '';
    await expect(service.create('anything')).rejects.toThrow('Cần cấu hình ADMIN_API_KEY');
  });
  it.each([
    ['bad', 3600],
    ['1', 60],
    ['999999', 86400],
  ])('bounds TTL %s', async (value, ttl) => {
    config.SESSION_TTL_SECONDS = value as string;
    expect((await service.create('admin-secret')).expiresIn).toBe(ttl);
  });
  it('authenticates protected routes with a valid session and fails closed on Redis errors', async () => {
    const guard = new AdminKeyGuard(settings, service);
    const session = await service.create('admin-secret');
    const req: any = { path: '/api/v1/leads', headers: { authorization: `Bearer ${session.accessToken}` } };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as any;
    expect(await guard.canActivate(context)).toBe(true);
    expect(req.sessionToken).toBe(session.accessToken);
    redis.client.get.mockRejectedValueOnce(new Error('Redis down'));
    await expect(guard.canActivate(context)).rejects.toThrow('Redis down');
    await service.revoke(session.accessToken);
    await expect(guard.canActivate(context)).rejects.toThrow('Cần X-API-Key');
  });
});
