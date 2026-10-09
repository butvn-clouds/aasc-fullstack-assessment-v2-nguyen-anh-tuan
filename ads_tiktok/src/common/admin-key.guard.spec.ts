import { ConfigService } from '@nestjs/config';
import { AdminKeyGuard } from './admin-key.guard';

describe('AdminKeyGuard', () => {
  const context = (path: string, key?: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ path, headers: { 'x-api-key': key } }) }) }) as any;
  const guard = (key?: string) =>
    new AdminKeyGuard({ get: () => key } as unknown as ConfigService, { validate: async () => null } as any);
  it('allows local demo without a key and leaves signed webhooks public', async () => {
    await expect(guard().canActivate(context('/api/v1/leads'))).resolves.toBe(true);
    await expect(guard('secret').canActivate(context('/webhooks/tiktok/leads'))).resolves.toBe(true);
  });
  it.each([undefined, '', ['secret'], 'bad', 'secrex'])('rejects invalid key %j', async (key) => {
    await expect(guard('secret').canActivate(context('/mock/tiktok/signed-request', key))).rejects.toThrow();
  });
  it('accepts a matching key', async () => {
    await expect(guard('secret').canActivate(context('/api/v1/leads', 'secret'))).resolves.toBe(true);
  });
});
