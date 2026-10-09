import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

jest.mock('ioredis');
describe('Redis cache', () => {
  const client = { get: jest.fn(), set: jest.fn(), del: jest.fn(), incr: jest.fn(), ping: jest.fn(), quit: jest.fn() };
  let service: RedisService;
  beforeEach(() => {
    jest.resetAllMocks();
    (Redis as unknown as jest.Mock).mockImplementation(() => client);
    service = new RedisService({ get: (_key: string, fallback: unknown) => fallback } as ConfigService);
    client.get.mockResolvedValue(null);
    client.set.mockResolvedValue('OK');
  });
  it('uses cached values without loading and caches misses', async () => {
    const load = jest.fn().mockResolvedValue({ total: 10 });
    client.get.mockResolvedValueOnce('{"total":1}');
    expect(await service.cached('key', 30, load)).toEqual({ total: 1 });
    expect(load).not.toHaveBeenCalled();
    expect(await service.cached('key', 30, load)).toEqual({ total: 10 });
    expect(client.set).toHaveBeenCalledWith('key', '{"total":10}', 'EX', 30);
  });
  it('falls back to the loader when Redis is down', async () => {
    client.get.mockRejectedValueOnce(new Error('offline'));
    client.set.mockRejectedValueOnce(new Error('offline'));
    expect(await service.cached('key', 1, async () => 99)).toBe(99);
  });
  it('supports health, assignment counter, invalidation and shutdown', async () => {
    client.ping.mockResolvedValue('PONG');
    expect(await service.ping()).toBe(true);
    client.ping.mockResolvedValue('NO');
    expect(await service.ping()).toBe(false);
    client.incr.mockResolvedValue(3);
    expect(await service.incr('rr')).toBe(3);
    await service.del('key');
    expect(client.del).toHaveBeenCalledWith('key');
    await service.onModuleDestroy();
    expect(client.quit).toHaveBeenCalled();
  });
});
