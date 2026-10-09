import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CONFIG_KEYS } from '../common/constants';
import { RedisService } from '../common/redis.service';
import { Configuration } from '../database/entities';
import { DEFAULT_MAPPING, DEFAULT_RULES } from './configuration';

@Injectable()
export class ConfigStoreService {
  constructor(
    @InjectRepository(Configuration) private readonly repo: Repository<Configuration>,
    private readonly redis: RedisService,
  ) {}

  private defaults: Record<string, unknown> = {
    [CONFIG_KEYS.MAPPING]: DEFAULT_MAPPING,
    [CONFIG_KEYS.RULES]: DEFAULT_RULES,
    [CONFIG_KEYS.COSTS]: {},
  };

  async get<T = unknown>(key: string): Promise<T> {
    return this.redis.cached<T>(`cfg:${key}`, 60, async () => {
      const row = await this.repo.findOne({ where: { key } });
      return (row ? row.value : this.defaults[key]) as T;
    });
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.repo.upsert({ key, value } as QueryDeepPartialEntity<Configuration>, ['key']);
    await this.redis.del(`cfg:${key}`);
  }
}
