import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsModule } from './analytics/analytics.module';
import { Bitrix24Module } from './bitrix24/bitrix24.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { LoggingInterceptor } from './common/logging.interceptor';
import { RedisModule } from './common/redis.service';
import { ConfigStoreModule } from './config/config.module';
import * as entities from './database/entities';
import { DealsModule } from './deals/deals.module';
import { HealthModule } from './health/health.module';
import { LeadsModule } from './leads/leads.module';
import { TikTokModule } from './tiktok/tiktok.module';
import { AdminKeyGuard } from './common/admin-key.guard';
import { SessionModule } from './auth/session.module';
import { databaseOptions, validateInfrastructure } from './config/infrastructure';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateInfrastructure }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        ...databaseOptions(
          Object.fromEntries(
            [
              'NODE_ENV',
              'DB_HOST',
              'DB_PORT',
              'DB_USER',
              'DB_PASSWORD',
              'DB_NAME',
              'REDIS_PASSWORD',
              'DB_POOL_MAX',
              'DB_CONNECTION_TIMEOUT_MS',
              'DB_IDLE_TIMEOUT_MS',
            ].map((key) => [key, c.get<string>(key)]),
          ),
        ),
        entities: Object.values(entities),
        retryAttempts: 5,
        retryDelay: 3000,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        connection: {
          host: c.get('REDIS_HOST', 'localhost'),
          port: Number(c.get('REDIS_PORT', 6379)),
          password: c.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    RedisModule,
    SessionModule,
    DealsModule,
    ConfigStoreModule,
    TikTokModule,
    LeadsModule,
    Bitrix24Module,
    AnalyticsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AdminKeyGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
