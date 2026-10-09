import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionService, matchesSecret } from '../auth/session.service';

@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const expected = this.config.get<string>('ADMIN_API_KEY');
    if (!expected || !/^\/(api\/|mock\/)/.test(req.path)) return true;
    const actual = req.headers['x-api-key'];
    if (matchesSecret(actual, expected)) return true;
    const header = req.headers.authorization;
    const token = typeof header === 'string' ? /^Bearer ([a-f0-9]{64})$/i.exec(header)?.[1] : undefined;
    if (token && (await this.sessions.validate(token))) {
      req.sessionToken = token;
      return true;
    }
    throw new UnauthorizedException('Cần X-API-Key hoặc phiên đăng nhập Bearer hợp lệ');
  }
}
