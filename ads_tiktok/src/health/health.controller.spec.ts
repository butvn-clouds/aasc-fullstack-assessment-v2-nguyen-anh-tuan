import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { RedisService } from '../common/redis.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const build = (ping: () => Promise<boolean>) => {
    const db = { pingCheck: jest.fn().mockResolvedValue({ postgres: { status: 'up' } }) };
    const health = {
      check: jest.fn(async (indicators: Array<() => Promise<unknown>>) => Promise.all(indicators.map((i) => i()))),
    };
    const controller = new HealthController(
      health as unknown as HealthCheckService,
      db as unknown as TypeOrmHealthIndicator,
      { ping } as unknown as RedisService,
    );
    return { controller, db };
  };

  it('báo postgres và redis up', async () => {
    const { controller, db } = build(async () => true);
    await expect(controller.check()).resolves.toEqual([{ postgres: { status: 'up' } }, { redis: { status: 'up' } }]);
    expect(db.pingCheck).toHaveBeenCalledWith('postgres');
  });

  it('báo redis down khi ping lỗi hoặc sai', async () => {
    await expect(build(async () => false).controller.check()).resolves.toContainEqual({ redis: { status: 'down' } });
    await expect(build(() => Promise.reject(new Error('x'))).controller.check()).resolves.toContainEqual({
      redis: { status: 'down' },
    });
  });
});
