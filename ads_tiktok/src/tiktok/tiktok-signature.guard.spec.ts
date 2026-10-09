import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signPayload, TikTokSignatureGuard } from './tiktok-signature.guard';

const SECRET = 's3cret';
const guard = new TikTokSignatureGuard({
  get: (_k: string, d: any) => d,
  getOrThrow: () => SECRET,
} as unknown as ConfigService);
const ctx = (headers: any, rawBody?: Buffer): any => ({
  switchToHttp: () => ({ getRequest: () => ({ headers, rawBody }) }),
});

describe('TikTokSignatureGuard', () => {
  const body = Buffer.from('{"event":"lead.generate"}');
  const now = () => Math.floor(Date.now() / 1000);

  it('chấp nhận chữ ký hợp lệ', () => {
    const t = now();
    expect(guard.canActivate(ctx({ 'tiktok-signature': `t=${t},s=${signPayload(SECRET, t, body)}` }, body))).toBe(true);
  });
  it('từ chối thiếu header', () => {
    expect(() => guard.canActivate(ctx({}, body))).toThrow(UnauthorizedException);
  });
  it('từ chối chữ ký sai', () => {
    const t = now();
    expect(() => guard.canActivate(ctx({ 'tiktok-signature': `t=${t},s=${'0'.repeat(64)}` }, body))).toThrow(
      'Chữ ký không hợp lệ',
    );
  });
  it('từ chối body bị sửa', () => {
    const t = now();
    const sig = signPayload(SECRET, t, body);
    expect(() =>
      guard.canActivate(ctx({ 'tiktok-signature': `t=${t},s=${sig}` }, Buffer.from('{"event":"x"}'))),
    ).toThrow(UnauthorizedException);
  });
  it('từ chối timestamp quá cũ (replay)', () => {
    const t = now() - 3600;
    expect(() =>
      guard.canActivate(ctx({ 'tiktok-signature': `t=${t},s=${signPayload(SECRET, t, body)}` }, body)),
    ).toThrow('hết hạn');
  });
});
