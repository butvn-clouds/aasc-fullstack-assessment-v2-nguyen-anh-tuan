import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const started = Date.now();
    const path = String(req.originalUrl ?? '')
      .split(/[?#]/, 1)[0]
      .replace(/[\r\n]/g, '');
    return next.handle().pipe(tap(() => this.logger.log(`${req.method} ${path} ${Date.now() - started}ms`)));
  }
}
