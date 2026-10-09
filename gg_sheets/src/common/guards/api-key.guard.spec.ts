import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './api-key.guard';

function makeContext(headerValue?: string): ExecutionContext {
  const request = { header: (name: string) => (name === 'x-api-key' ? headerValue : undefined) };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  it('rejects the published example key even when it matches', () => {
    const guard = new ApiKeyGuard({ get: () => 'replace_with_random_api_key' } as any);
    expect(() => guard.canActivate(makeContext('replace_with_random_api_key'))).toThrow(
      UnauthorizedException,
    );
  });
  it('allows the request when the header matches MANAGEMENT_API_KEY', () => {
    const configService = { get: () => 'secret-key' } as unknown as ConfigService;
    const guard = new ApiKeyGuard(configService);

    expect(guard.canActivate(makeContext('secret-key'))).toBe(true);
  });

  it('rejects when the header is missing', () => {
    const configService = { get: () => 'secret-key' } as unknown as ConfigService;
    const guard = new ApiKeyGuard(configService);

    expect(() => guard.canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
  });

  it('rejects when the header does not match', () => {
    const configService = { get: () => 'secret-key' } as unknown as ConfigService;
    const guard = new ApiKeyGuard(configService);

    expect(() => guard.canActivate(makeContext('wrong-key'))).toThrow(UnauthorizedException);
  });

  it('rejects when MANAGEMENT_API_KEY itself is not configured (fail closed, not open)', () => {
    const configService = { get: () => undefined } as unknown as ConfigService;
    const guard = new ApiKeyGuard(configService);

    expect(() => guard.canActivate(makeContext('anything'))).toThrow(UnauthorizedException);
  });
});
