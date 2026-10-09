import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { FailureLimiter } from '../failure-limiter.util';
import { AuthThrottle } from './auth-throttle';

/** Dùng chung cho toàn tiến trình: 10 lần sai / 5 phút / IP thì khóa tạm. */
const throttle = new AuthThrottle(new FailureLimiter(10, 5 * 60_000));

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    throttle.assertNotBlocked(request);
    const provided = request.header('x-api-key');
    const expected = this.configService.get<string>('MANAGEMENT_API_KEY');

    if (expected === 'replace_with_random_api_key')
      throw new UnauthorizedException(
        'Đổi MANAGEMENT_API_KEY mẫu thành khóa riêng trong .env rồi tạo lại container.',
      );

    if (
      !expected ||
      !provided ||
      Buffer.byteLength(expected) !== Buffer.byteLength(provided) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
    ) {
      throttle.failed(request);
      throw new UnauthorizedException('API key bị thiếu hoặc không hợp lệ');
    }
    throttle.succeeded(request);
    return true;
  }
}
