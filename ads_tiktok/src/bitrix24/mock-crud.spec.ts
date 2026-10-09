import { ConfigService } from '@nestjs/config';
import { Bitrix24Client } from './bitrix24.client';

describe('Bitrix mock CRUD and remote idempotency', () => {
  const query = jest.fn();
  let client: Bitrix24Client;
  beforeEach(() => {
    jest.clearAllMocks();
    client = new Bitrix24Client({ get: () => 'true' } as unknown as ConfigService, { query } as any);
  });
  it('lists records and reads a lead', async () => {
    query
      .mockResolvedValueOnce([{ id: 1, fields: { NAME: 'Lead' } }])
      .mockResolvedValueOnce([{ fields: { NAME: 'Lead' } }]);
    expect(await client.call('crm.lead.list', { start: 0 })).toEqual([{ NAME: 'Lead', ID: 1 }]);
    expect(await client.call('crm.lead.get', { id: 1 })).toEqual({ NAME: 'Lead', ID: 1 });
  });
  it.each(['crm.deal.update', 'crm.deal.delete', 'crm.lead.delete'])(
    'supports %s and reports missing IDs',
    async (method) => {
      query.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
      expect(await client.call(method, { id: 1, fields: { STAGE_ID: 'WON' } })).toBe(true);
      await expect(client.call(method, { id: 2 })).rejects.toThrow('không tìm thấy');
    },
  );
  it('rejects missing lead reads and unsupported methods', async () => {
    query.mockResolvedValue([]);
    await expect(client.call('crm.lead.get', { id: 99 })).rejects.toThrow('không tìm thấy');
    await expect(client.call('unsupported', {})).rejects.toThrow('chưa hỗ trợ');
  });
  it('looks up stable origin IDs before creating on real CRM', async () => {
    const runner = { connect: jest.fn(), query: jest.fn(), release: jest.fn() };
    client = new Bitrix24Client(
      {
        get: (key: string) => (key === 'BITRIX24_MOCK' ? 'false' : 'https://example.invalid/rest/'),
      } as unknown as ConfigService,
      { createQueryRunner: () => runner } as any,
    );
    const call = jest
      .spyOn(client, 'call')
      .mockResolvedValueOnce([{ ID: '19' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(20);
    expect(await client.addDeal({ ORIGIN_ID: 'local-uuid', ORIGINATOR_ID: 'tiktok-integration' })).toBe(19);
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(await client.addLead({ ORIGIN_ID: 'new-local' })).toBe(20);
    expect(call).toHaveBeenCalledWith(
      'crm.deal.list',
      expect.objectContaining({ filter: { '=ORIGIN_ID': 'local-uuid', '=ORIGINATOR_ID': 'tiktok-integration' } }),
    );
  });
});
