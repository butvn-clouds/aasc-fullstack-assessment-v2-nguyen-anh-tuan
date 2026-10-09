import { Repository } from 'typeorm';
import { CONFIG_KEYS } from '../common/constants';
import { RedisService } from '../common/redis.service';
import { Configuration } from '../database/entities';
import { DEFAULT_MAPPING, DEFAULT_RULES } from './configuration';
import { ConfigStoreService } from './config-store.service';

describe('ConfigStoreService', () => {
  let repo: { findOne: jest.Mock; upsert: jest.Mock };
  let redis: { cached: jest.Mock; del: jest.Mock };
  let service: ConfigStoreService;

  beforeEach(() => {
    repo = { findOne: jest.fn(), upsert: jest.fn().mockResolvedValue(undefined) };
    redis = { cached: jest.fn((_k, _ttl, loader) => loader()), del: jest.fn().mockResolvedValue(undefined) };
    service = new ConfigStoreService(repo as unknown as Repository<Configuration>, redis as unknown as RedisService);
  });

  it('đọc qua cache 60 giây và ưu tiên giá trị trong DB', async () => {
    repo.findOne.mockResolvedValue({ value: { a: 'B' } });
    await expect(service.get(CONFIG_KEYS.MAPPING)).resolves.toEqual({ a: 'B' });
    expect(redis.cached).toHaveBeenCalledWith(`cfg:${CONFIG_KEYS.MAPPING}`, 60, expect.any(Function));
  });

  it('dùng giá trị mặc định khi DB chưa có', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.get(CONFIG_KEYS.MAPPING)).resolves.toEqual(DEFAULT_MAPPING);
    await expect(service.get(CONFIG_KEYS.RULES)).resolves.toEqual(DEFAULT_RULES);
    expect(DEFAULT_RULES[0].pipeline_id).toBe('0');
    await expect(service.get(CONFIG_KEYS.COSTS)).resolves.toEqual({});
  });

  it('ghi upsert rồi xóa cache', async () => {
    await service.set(CONFIG_KEYS.RULES, [{ x: 1 }]);
    expect(repo.upsert).toHaveBeenCalledWith({ key: CONFIG_KEYS.RULES, value: [{ x: 1 }] }, ['key']);
    expect(redis.del).toHaveBeenCalledWith(`cfg:${CONFIG_KEYS.RULES}`);
  });
});
