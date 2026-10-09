import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Header giả định: `TikTok-Signature: t=<unix_seconds>,s=<hex hmac-sha256>`
 * với s = HMAC_SHA256(secret, `${t}.${rawBody}`). Chống replay bằng tolerance.
 */
export function signPayload(secret: string, timestamp: number, rawBody: string | Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

@Injectable()
export class TikTokSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['tiktok-signature'];
    const raw: Buffer | undefined = req.rawBody;
    if (!header || !raw) throw new UnauthorizedException('Thiếu chữ ký');

    const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
    const ts = Number(parts.t);
    const sig = parts.s;
    if (!ts || !sig) throw new UnauthorizedException('Chữ ký sai định dạng');

    const tolerance = Number(this.config.get('TIKTOK_SIGNATURE_TOLERANCE_SEC', 300));
    if (Math.abs(Date.now() / 1000 - ts) > tolerance) throw new UnauthorizedException('Chữ ký đã hết hạn');

    const expected = Buffer.from(signPayload(this.config.getOrThrow('TIKTOK_WEBHOOK_SECRET'), ts, raw), 'hex');
    const given = Buffer.from(sig, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Chữ ký không hợp lệ');
    }
    return true;
  }
}
