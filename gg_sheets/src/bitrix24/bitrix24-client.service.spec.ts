import { ConfigService } from '@nestjs/config';
import { Bitrix24ApiError, Bitrix24ClientService } from './bitrix24-client.service';

// Bỏ thời gian chờ thử lại trong kiểm thử đơn vị.
// Cơ chế thử lại được kiểm tra riêng trong common/retry.util.
// Tại đây chỉ kiểm tra lời gọi máy khách và lỗi được trả về.
jest.mock('../common/retry.util', () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));

describe('Bitrix24ClientService', () => {
  const configService = {
    getOrThrow: () => 'https://mock.bitrix24.com/rest/1/token/',
    get: (_key: string, fallback: unknown) => fallback,
  } as unknown as ConfigService;

  let client: Bitrix24ClientService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    client = new Bitrix24ClientService(configService);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  function mockResponse(body: unknown, ok = true) {
    fetchMock.mockResolvedValue({ ok, json: () => Promise.resolve(body) });
  }

  it('reads all lead pages with explicitly selected contact fields', async () => {
    const first = Array.from({ length: 50 }, (_, i) => ({ ID: String(i + 1) }));
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: first }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: [{ ID: '51' }] }) });
    expect(await client.getAllLeads(['EMAIL', 'PHONE'])).toHaveLength(51);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      start: 50,
      select: ['ID', 'DATE_MODIFY', 'EMAIL', 'PHONE'],
    });
  });

  it('createLead posts to crm.lead.add and returns the new numeric ID', async () => {
    mockResponse({ result: 789 });

    const id = await client.createLead({ NAME: 'A' });

    expect(id).toBe(789);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('crm.lead.add.json');
    expect(JSON.parse(options.body)).toEqual({ fields: { NAME: 'A' } });
  });

  it('updateLead posts id + fields to crm.lead.update', async () => {
    mockResponse({ result: true });

    await client.updateLead(456, { NAME: 'B' });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('crm.lead.update.json');
    expect(JSON.parse(options.body)).toEqual({ id: 456, fields: { NAME: 'B' } });
  });

  it('findLeadByEmailOrPhone calls crm.duplicate.findbycomm with entity_type LEAD and type EMAIL (exact match, not substring)', async () => {
    mockResponse({ result: { LEAD: ['999'] } });

    const found = await client.findLeadByEmailOrPhone('a@email.com', '+84901234567');

    const [url, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(url).toContain('crm.duplicate.findbycomm.json');
    expect(body).toEqual({ entity_type: 'LEAD', type: 'EMAIL', values: ['a@email.com'] });
    expect(found).toEqual({ ID: '999' });
    // Vẫn kiểm tra điện thoại để phát hiện mâu thuẫn giữa hai Lead.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('findLeadByEmailOrPhone falls back to searching by phone when email has no match', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: {} }) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: { LEAD: ['777'] } }),
      });

    const found = await client.findLeadByEmailOrPhone('a@email.com', '+84901234567');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondCallBody).toEqual({
      entity_type: 'LEAD',
      type: 'PHONE',
      values: ['+84901234567'],
    });
    expect(found).toEqual({ ID: '777' });
  });

  it('rejects different leads matched by email and phone', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { LEAD: ['1'] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { LEAD: ['2'] } }) });
    await expect(client.findLeadByEmailOrPhone('a@example.com', '+84901234567')).rejects.toThrow(
      'khác nhau',
    );
  });

  it('rejects multiple matches for one contact', async () => {
    mockResponse({ result: { LEAD: ['1', '2'] } });
    await expect(client.findLeadByEmailOrPhone('a@example.com')).rejects.toThrow('nhiều Lead');
  });

  it('preserves HTTP status for non-JSON upstream failures', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('html');
      },
    });
    await expect(client.call('crm.lead.list')).rejects.toMatchObject({
      status: 503,
      code: 'INVALID_RESPONSE',
    });
  });

  it('findLeadByEmailOrPhone returns null when neither email nor phone is provided, without calling the API', async () => {
    const found = await client.findLeadByEmailOrPhone(undefined, undefined);

    expect(found).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('findLeadByEmailOrPhone returns null when Bitrix24 finds no match on either field', async () => {
    mockResponse({ result: {} }); // Không có khóa LEAD khi không có bản ghi trùng.

    const found = await client.findLeadByEmailOrPhone('nobody@email.com');

    expect(found).toBeNull();
  });

  it('REGRESSION: never uses a "%"-prefixed (LIKE/substring) filter for dedup lookups', async () => {
    mockResponse({ result: {} });

    await client.findLeadByEmailOrPhone('a@email.com', '+84901234567');

    for (const [, options] of fetchMock.mock.calls) {
      const body = JSON.parse(options.body);
      expect(Object.keys(body.filter ?? {}).some((k) => k.startsWith('%'))).toBe(false);
    }
  });

  it('throws Bitrix24ApiError with the code/description when Bitrix24 returns an error', async () => {
    mockResponse({ error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Too many requests' });

    await expect(client.createLead({ NAME: 'A' })).rejects.toThrow(Bitrix24ApiError);
    await expect(client.createLead({ NAME: 'A' })).rejects.toThrow(/QUERY_LIMIT_EXCEEDED/);
  });

  it('throws Bitrix24ApiError when the HTTP response is not ok, even without a body.error', async () => {
    mockResponse({}, false);

    await expect(client.createLead({ NAME: 'A' })).rejects.toThrow(Bitrix24ApiError);
  });
});
