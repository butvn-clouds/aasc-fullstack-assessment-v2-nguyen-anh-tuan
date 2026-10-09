import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorResult, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { RedisService } from '../common/redis.service';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Hệ thống')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisService,
  ) {}

  @ApiOperation({ summary: 'Kiểm tra kết nối PostgreSQL và Redis' })
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('postgres'),
      async (): Promise<HealthIndicatorResult> => ({
        redis: { status: (await this.redis.ping().catch(() => false)) ? 'up' : 'down' },
      }),
    ]);
  }
}
