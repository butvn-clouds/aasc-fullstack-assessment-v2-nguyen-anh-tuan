import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { RedisService } from '../common/redis.service';

export function matchesSecret(actual: unknown, expected: string): boolean {
  return (
    typeof actual === 'string' &&
    Buffer.byteLength(actual) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

@Injectable()
export class SessionService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
  private key(token: string) {
    return `auth:session:${this.hash(token)}`;
  }

  async create(apiKey: unknown) {
    const secret = this.config.get<string>('ADMIN_API_KEY');
    if (!secret) throw new ServiceUnavailableException('Cần cấu hình ADMIN_API_KEY để bật phiên đăng nhập');
    if (!matchesSecret(apiKey, secret)) throw new UnauthorizedException('Khóa API không hợp lệ');
    const configured = Number(this.config.get('SESSION_TTL_SECONDS', 3600));
    const ttl = Number.isFinite(configured) ? Math.max(60, Math.min(86400, Math.floor(configured))) : 3600;
    const token = randomBytes(32).toString('hex');
    const session = {
      role: 'admin',
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      keyVersion: this.hash(secret),
    };
    await this.redis.client.set(this.key(token), JSON.stringify(session), 'EX', ttl);
    return { accessToken: token, tokenType: 'Bearer', expiresIn: ttl, expiresAt: session.expiresAt };
  }

  async validate(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const secret = this.config.get<string>('ADMIN_API_KEY');
    if (!secret) return null;
    const raw = await this.redis.client.get(this.key(token));
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session.keyVersion !== this.hash(secret) || Date.parse(session.expiresAt) <= Date.now()) return null;
    return { role: session.role, expiresAt: session.expiresAt };
  }

  async revoke(token: string) {
    await this.redis.client.del(this.key(token));
  }
}
