import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DataSource } from 'typeorm';
import { Bitrix24Client } from './bitrix24.client';

jest.mock('axios', () => ({
  create: jest.fn(),
  isAxiosError: (error: unknown) => Boolean(error && typeof error === 'object' && 'isAxiosError' in error),
}));

describe('Bitrix24Client', () => {
  let post: jest.Mock;
  let ds: DataSource;
  let nextId: number;
  let records: Map<number, { kind: string; fields: any }>;
  const mockConfig = {
    get: (key: string, fallback?: string) => (key === 'BITRIX24_MOCK' ? 'true' : fallback),
  } as ConfigService;
  let client: Bitrix24Client;

  beforeEach(() => {
    post = jest.fn();
    nextId = 100;
    records = new Map();
    ds = {
      query: jest.fn(async (sql: string, args: any[]) => {
        if (sql.startsWith('INSERT INTO bitrix_mock_records (kind')) {
          const id = nextId++;
          records.set(id, { kind: args[0], fields: JSON.parse(args[1]) });
          return [{ id }];
        }
        if (sql.startsWith('WITH updated')) {
          const row = records.get(args[0]);
          if (!row || row.kind !== 'lead') return [];
          Object.assign(row.fields, JSON.parse(args[1]));
          return [{ id: args[0] }];
        }
        if (sql.startsWith('SELECT fields')) {
          const row = records.get(args[0]);
          return row?.kind === 'deal' ? [{ fields: row.fields }] : [];
        }
        return [];
      }),
    } as unknown as DataSource;
    (axios.create as jest.Mock).mockReturnValue({ post });
    client = new Bitrix24Client(
      {
        get: (key: string, fallback?: string) =>
          key === 'BITRIX24_WEBHOOK_URL' ? 'https://portal.bitrix24.com/rest/1/test-hook/' : fallback,
      } as unknown as ConfigService,
      ds,
    );
  });

  it('gọi REST method và trả về trường result', async () => {
    post.mockResolvedValueOnce({ data: { result: 123 } });

    await expect(client.call('crm.lead.get', { id: 123 })).resolves.toBe(123);
    expect(axios.create).toHaveBeenCalledWith({
      baseURL: 'https://portal.bitrix24.com/rest/1/test-hook/',
      timeout: 10000,
    });
    expect(post).toHaveBeenCalledWith('crm.lead.get.json', { id: 123 });
  });

  it('giữ Retry-After của HTTP 429 để queue chờ đủ thời gian', async () => {
    post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 429, headers: { 'retry-after': '2' }, data: {} },
    });
    await expect(client.call('crm.lead.update', {})).rejects.toMatchObject({ status: 429, retryAfterMs: 2000 });
  });

  it('báo rõ portal thiếu VND và không tạo deal với đơn vị khác', async () => {
    post.mockResolvedValueOnce({ data: { result: [{ CURRENCY: 'USD' }, { CURRENCY: 'EUR' }] } });
    await expect(client.addDeal({ CURRENCY_ID: 'VND', OPPORTUNITY: 15000000 })).rejects.toThrow(
      'Portal chưa bật tiền tệ VND',
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('crm.currency.list.json', {});
  });

  it('giữ nguyên số tiền VND khi portal hỗ trợ VND', async () => {
    post.mockResolvedValueOnce({ data: { result: [{ CURRENCY: 'VND' }] } });
    post.mockResolvedValueOnce({ data: { result: 77 } });
    const fields = { CURRENCY_ID: 'VND', OPPORTUNITY: 15000000 };
    await expect(client.addDeal(fields)).resolves.toBe(77);
    expect(post).toHaveBeenLastCalledWith('crm.deal.add.json', { fields });
  });

  it('chuyển lỗi REST từ Bitrix thành lỗi có method và mã lỗi', async () => {
    post.mockResolvedValueOnce({ data: { error: 'ACCESS_DENIED', error_description: 'No access' } });

    await expect(client.call('crm.lead.list', {})).rejects.toThrow('crm.lead.list: ACCESS_DENIED No access');
  });

  it('giữ mã lỗi và mô tả Bitrix trả về cho HTTP 4xx', async () => {
    post.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: { error: 'ERROR_STAGE_ID', error_description: 'Invalid deal stage' },
      },
    });

    await expect(client.call('crm.deal.add', {})).rejects.toMatchObject({
      name: 'BitrixHttpError',
      status: 400,
      message: 'Bitrix24 crm.deal.add HTTP 400: ERROR_STAGE_ID: Invalid deal stage',
    });
  });

  it('từ chối khởi động khi chưa cấu hình HTTPS portal thật', () => {
    expect(
      () =>
        new Bitrix24Client(
          {
            get: () => 'http://localhost:4010/rest/1/mock/',
          } as unknown as ConfigService,
          ds,
        ),
    ).toThrow('BITRIX24_WEBHOOK_URL');
  });

  it('persists mock Lead and Deal CRUD across client restarts', async () => {
    (axios.create as jest.Mock).mockClear();
    client = new Bitrix24Client(
      {
        get: (key: string, fallback?: string) => (key === 'BITRIX24_MOCK' ? 'true' : fallback),
      } as unknown as ConfigService,
      ds,
    );

    const leadId = await client.addLead({ TITLE: 'Demo lead' });
    await expect(client.updateLead(leadId, { NAME: 'Updated demo lead' })).resolves.toBe(true);
    const dealId = await client.addDeal({ TITLE: 'Demo deal', STAGE_ID: 'NEW' });
    client = new Bitrix24Client(mockConfig, ds);
    await expect(client.updateLead(leadId, { NAME: 'After restart' })).resolves.toBe(true);
    expect(await client.addDeal({ TITLE: 'Next deal' })).toBeGreaterThan(dealId);
    await expect(client.getDeal(dealId)).resolves.toMatchObject({ ID: dealId, TITLE: 'Demo deal', STAGE_ID: 'NEW' });
    expect(axios.create).not.toHaveBeenCalled();
  });

  it('rejects mock updates and reads for unknown entities', async () => {
    client = new Bitrix24Client(
      {
        get: (key: string, fallback?: string) => (key === 'BITRIX24_MOCK' ? 'true' : fallback),
      } as unknown as ConfigService,
      ds,
    );

    await expect(client.updateLead(12, { NAME: 'Missing' })).rejects.toThrow('không tìm thấy khách hàng tiềm năng 12');
    await expect(client.getDeal(23)).rejects.toThrow('không tìm thấy giao dịch 23');
  });

  it('allocates distinct IDs across concurrent mock clients', async () => {
    const clients = [new Bitrix24Client(mockConfig, ds), new Bitrix24Client(mockConfig, ds)];
    const ids = await Promise.all(Array.from({ length: 20 }, (_, i) => clients[i % 2].addDeal({ TITLE: `Deal ${i}` })));
    expect(new Set(ids).size).toBe(20);
    expect(Math.min(...ids)).toBe(100);
  });

  it('reads legacy deals when the mock store has no record', async () => {
    (ds.query as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ fields: { TITLE: 'Legacy deal', OPPORTUNITY: 16200000, STAGE_ID: 'NEW' } }]);
    client = new Bitrix24Client(mockConfig, ds);
    await expect(client.getDeal(27)).resolves.toEqual({
      ID: 27,
      TITLE: 'Legacy deal',
      OPPORTUNITY: 16200000,
      STAGE_ID: 'NEW',
    });
  });

  it('keeps mock CRM in-process even with a stale mock API URL', async () => {
    client = new Bitrix24Client(
      {
        get: (key: string, fallback?: string) =>
          (
            ({
              BITRIX24_MOCK: 'true',
              BITRIX24_MOCK_API_URL: 'http://mock-api:4000/rest/',
            }) as Record<string, string>
          )[key] ?? fallback,
      } as ConfigService,
      ds,
    );
    await expect(client.addDeal({ TITLE: 'Local demo' })).resolves.toBe(100);
    expect(post).not.toHaveBeenCalled();
    expect(ds.query).toHaveBeenCalled();
  });

  it('dùng đúng payload cho các thao tác lead và deal', async () => {
    post.mockResolvedValue({ data: { result: true } });
    await client.addLead({ TITLE: 'Khách thử' });
    await client.updateLead(5, { TITLE: 'Đã cập nhật' });
    await client.addDeal({ TITLE: 'Deal thử' });
    await client.getDeal(7);

    expect(post.mock.calls).toEqual([
      ['crm.lead.add.json', { fields: { TITLE: 'Khách thử' }, params: { REGISTER_SONET_EVENT: 'Y' } }],
      ['crm.lead.update.json', { id: 5, fields: { TITLE: 'Đã cập nhật' } }],
      ['crm.deal.add.json', { fields: { TITLE: 'Deal thử' } }],
      ['crm.deal.get.json', { id: 7 }],
    ]);
  });
});

describe('Bitrix24 real-mode idempotency lock', () => {
  it('reuses a remote Deal on retry and releases the database lock', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({ data: { result: [] } })
      .mockResolvedValueOnce({ data: { result: 91 } })
      .mockResolvedValueOnce({ data: { result: [{ ID: '91' }] } });
    (axios.create as jest.Mock).mockReturnValue({ post });
    const runner = { connect: jest.fn(), query: jest.fn(), release: jest.fn() };
    const ds = { createQueryRunner: jest.fn(() => runner) } as unknown as DataSource;
    const client = new Bitrix24Client(
      {
        get: (key: string, fallback?: string) =>
          key === 'BITRIX24_WEBHOOK_URL' ? 'https://portal.bitrix24.com/rest/1/test-hook/' : fallback,
      } as ConfigService,
      ds,
    );
    const fields = { ORIGINATOR_ID: 'tiktok-integration', ORIGIN_ID: 'lead-1' };
    await expect(client.addDeal(fields)).resolves.toBe(91);
    await expect(client.addDeal(fields)).resolves.toBe(91);
    expect(post.mock.calls.filter(([method]) => method === 'crm.deal.add.json')).toHaveLength(1);
    expect(runner.query).toHaveBeenCalledWith('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
      'bitrix-origin:deal:tiktok-integration:lead-1',
    ]);
    expect(runner.release).toHaveBeenCalledTimes(2);
  });

  it('releases the origin lock if remote creation fails', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({ data: { result: [] } })
      .mockRejectedValueOnce(new Error('connection reset'));
    (axios.create as jest.Mock).mockReturnValue({ post });
    const runner = { connect: jest.fn(), query: jest.fn(), release: jest.fn() };
    const client = new Bitrix24Client(
      {
        get: (key: string, fallback?: string) =>
          key === 'BITRIX24_WEBHOOK_URL' ? 'https://portal.bitrix24.com/rest/1/test-hook/' : fallback,
      } as ConfigService,
      { createQueryRunner: () => runner } as unknown as DataSource,
    );
    await expect(client.addDeal({ ORIGINATOR_ID: 'tiktok-integration', ORIGIN_ID: 'lead-1' })).rejects.toThrow(
      'connection reset',
    );
    expect(runner.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
      'bitrix-origin:deal:tiktok-integration:lead-1',
    ]);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
});
