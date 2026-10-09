import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { FailureLimiter } from '../failure-limiter.util';
import { AuthThrottle } from './auth-throttle';

const throttle = new AuthThrottle(new FailureLimiter(20, 5 * 60_000));

/** Xác thực bằng bí mật dùng chung cho endpoint nhận sự kiện webhook Bitrix. */
@Injectable()
export class BitrixWebhookGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    throttle.assertNotBlocked(request);
    const expected = this.config.get<string>('BITRIX24_WEBHOOK_SECRET');
    const received =
      request.body?.auth?.application_token ??
      request.body?.['auth[application_token]'] ??
      request.header('x-bitrix-webhook-secret');
    if (!expected || typeof received !== 'string' || !received) {
      throttle.failed(request);
      throw new UnauthorizedException('Bí mật xác thực webhook Bitrix không hợp lệ');
    }
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throttle.failed(request);
      throw new UnauthorizedException('Bí mật xác thực webhook Bitrix không hợp lệ');
    }
    throttle.succeeded(request);
    return true;
  }
}
