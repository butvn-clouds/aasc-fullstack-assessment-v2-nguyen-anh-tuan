import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis({
      host: config.get('REDIS_HOST', 'localhost'),
      port: Number(config.get('REDIS_PORT', 6379)),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: 3,
    });
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async cached<T>(key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
    const hit = await this.client.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as T;
    const value = await loader();
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSec).catch(() => undefined);
    return value;
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
