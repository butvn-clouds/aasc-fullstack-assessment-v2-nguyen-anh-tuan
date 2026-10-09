import { ConnectionCheckService } from './connection-check.service';
import { BitrixWebhookController } from './bitrix-webhook.controller';

beforeEach(() => {
  jest.spyOn(global, 'fetch').mockImplementation(
    async (_url, options) =>
      ({
        status: 202,
        json: async () => ({
          receiver: 'bitrix-leads',
          probe: JSON.parse(String(options?.body)).probe,
        }),
      }) as Response,
  );
});
afterEach(() => jest.restoreAllMocks());

describe('Public webhook evidence', () => {
  function service() {
    const values = { PUBLIC_BASE_URL: 'https://example.com', BITRIX24_WEBHOOK_SECRET: 'secret' };
    return new ConnectionCheckService(
      { get: (key, fallback) => values[key] ?? fallback } as any,
      { checkConnection: async () => {} } as any,
      { call: async () => [] } as any,
      undefined,
      {
        list: () => ({
          runs: [
            {
              direction: 'webhook',
              startedAt: '2026-10-02T00:00:00Z',
              status: 'success',
              summary: { pulledDown: 2 },
            },
          ],
        }),
      } as any,
    );
  }
  it('verifies a challenge through public URL and reports actual history', async () => {
    const result = await service().check();
    expect(result.webhook.receiver.ok).toBe(true);
    expect(result.webhook.lastRun?.summary?.pulledDown).toBe(2);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/webhooks/bitrix24/leads',
      expect.objectContaining({ redirect: 'error', method: 'POST' }),
    );
  });
  it('reports a rejected token instead of claiming realtime works', async () => {
    jest.mocked(fetch).mockResolvedValue({ status: 401 } as Response);
    const result = await service().check();
    expect(result.webhook.receiver.ok).toBe(false);
    expect(result.webhook.message).toContain('401');
  });
  it('rejects an unrelated response', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValue({ status: 202, json: async () => ({ probe: 'wrong' }) } as Response);
    expect((await service().check()).webhook.receiver.ok).toBe(false);
  });
  it('reports network failures without leaking credentials', async () => {
    jest.mocked(fetch).mockRejectedValue(new Error('secret'));
    const result = await service().check();
    expect(result.webhook.receiver.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('does not enqueue or sync a diagnostic request', async () => {
    const enqueue = jest.fn();
    const controller = new BitrixWebhookController({ enqueue } as any);
    expect(
      await controller.leadChanged({ event: 'SYNC_CONNECTION_PROBE', probe: 'a'.repeat(32) }),
    ).toEqual({ receiver: 'bitrix-leads', probe: 'a'.repeat(32) });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('Kiểm tra kết nối an toàn', () => {
  it('chỉ đọc và không trả token', async () => {
    const call = jest.fn().mockResolvedValue([]);
    const checkConnection = jest.fn().mockResolvedValue(undefined);
    const config = {
      PUBLIC_BASE_URL: 'https://example.com',
      BITRIX24_WEBHOOK_SECRET: 'private-token',
    };
    const service = new ConnectionCheckService(
      { get: (key, fallback) => config[key] ?? fallback } as any,
      { checkConnection } as any,
      { call } as any,
    );
    const result = await service.check();
    expect(result.google.ok).toBe(true);
    expect(result.webhook.receiverUrl).toBe('https://example.com/webhooks/bitrix24/leads');
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(call).toHaveBeenCalledWith('crm.lead.list', { select: ['ID'], filter: { ID: '0' } }, 0);
  });
  it('ẩn lỗi thô và không chấp nhận URL chứa credentials', async () => {
    const service = new ConnectionCheckService(
      { get: () => 'https://secret@example.com' } as any,
      {
        checkConnection: async () => {
          throw new Error('private-token');
        },
      } as any,
      { call: async () => [] } as any,
    );
    const result = await service.check();
    expect(result.google.ok).toBe(false);
    expect(result.bitrix.ok).toBe(true);
    expect(result.webhook.receiverUrl).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private-token');
  });
});
