import { HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { FailureLimiter } from '../failure-limiter.util';

/** Áp dụng FailureLimiter cho một guard: chặn IP sau nhiều lần xác thực sai, trả 429 + Retry-After. */
export class AuthThrottle {
  constructor(private readonly limiter: FailureLimiter) {}

  private key(request: Request): string {
    return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
  }

  assertNotBlocked(request: Request): void {
    const key = this.key(request);
    if (!this.limiter.isBlocked(key)) return;
    const retry = this.limiter.retryAfterSeconds(key);
    throw new HttpException(
      {
        statusCode: 429,
        message: `Quá nhiều lần xác thực sai. Thử lại sau ${retry} giây.`,
        retryAfterSeconds: retry,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  failed(request: Request): void {
    this.limiter.fail(this.key(request));
  }

  succeeded(request: Request): void {
    this.limiter.reset(this.key(request));
  }
}
