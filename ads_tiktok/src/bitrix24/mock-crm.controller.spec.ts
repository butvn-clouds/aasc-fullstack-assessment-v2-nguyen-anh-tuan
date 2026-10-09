import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import axios from 'axios';
import { Bitrix24Client } from './bitrix24.client';
import { MockCrmController, MockOnlyGuard } from './mock-crm.controller';

jest.mock('axios', () => ({ post: jest.fn() }));
describe('Giả lập CRM in the app', () => {
  const call = jest.fn(),
    query = jest.fn(),
    get = jest.fn(),
    set = jest.fn();
  let controller: MockCrmController;
  beforeEach(() => {
    jest.clearAllMocks();
    call.mockResolvedValue(true);
    query.mockResolvedValue([{ id: 'retry-id' }]);
    get.mockImplementation((key, fallback) => (key === 'BITRIX24_APP_TOKEN' ? 'shared-token' : fallback));
    (axios.post as jest.Mock).mockResolvedValue({ data: { updated: true } });
    controller = new MockCrmController(
      { call } as unknown as Bitrix24Client,
      { get, set } as unknown as ConfigService,
      { query } as unknown as DataSource,
    );
  });
  it('guards demo endpoints with the explicit mock switch', () => {
    const guard = new MockOnlyGuard({ get: () => 'false' } as unknown as ConfigService);
    expect(() => guard.canActivate()).toThrow();
    expect(new MockOnlyGuard({ get: () => 'true' } as unknown as ConfigService).canActivate()).toBe(true);
  });
  it.each([
    ['other', 'get', {}],
    ['deal', 'unknown', {}],
    ['deal', 'get', { id: 0 }],
    ['lead', 'add', {}],
    ['deal', 'update', { id: 1, fields: [] }],
    ['deal', 'update', { id: 1, fields: { OPPORTUNITY: -1 } }],
  ])('validates %s/%s %j', async (entity, action, body) => {
    await expect(controller.crud(entity as string, action as string, body)).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it('performs CRUD and only calls back after deal updates', async () => {
    await expect(controller.crud('lead', 'get', { id: 1 })).resolves.toEqual({ result: true });
    expect(axios.post).not.toHaveBeenCalled();
    await expect(controller.crud('deal', 'update', { id: 1, fields: { STAGE_ID: 'WON' } })).resolves.toEqual({
      result: true,
      callback: { updated: true },
    });
    expect(axios.post).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/webhooks/bitrix24/deals',
      expect.objectContaining({ auth: { application_token: 'shared-token' } }),
      { timeout: 10000 },
    );
  });
  it('reports persistence success separately from callback failure', async () => {
    (axios.post as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    await expect(controller.crud('deal', 'update', { id: 1, fields: {} })).rejects.toThrow('Đã cập nhật CRM');
  });
  it('exposes CRM errors and lists/retries failed conversions', async () => {
    call.mockRejectedValueOnce(new Error('missing'));
    await expect(controller.crud('deal', 'get', { id: 1 })).rejects.toThrow('missing');
    await controller.conversions();
    await expect(controller.retry('bad')).rejects.toThrow();
    await expect(controller.retry('12345678-1234-1234-1234-123456789012')).resolves.toEqual({ queued: true });
  });
});
