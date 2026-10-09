import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NotificationService } from './notification.service';
import { DataSource, EntityManager } from 'typeorm';

jest.mock('axios');
const post = axios.post as jest.Mock;

describe('NotificationService', () => {
  const query = jest.fn();
  const make = (url?: string) =>
    new NotificationService({ get: () => url } as unknown as ConfigService, { query } as unknown as DataSource);
  const row = { id: '1', event_key: 'event-1', event: 'deal.won', payload: { dealId: '1' }, attempts: 1 };
  beforeEach(() => {
    jest.resetAllMocks();
    query.mockResolvedValue([]);
  });

  it('lưu thông báo qua cùng transaction thay vì gửi trước commit', async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    await make().notify('deal.created', { dealId: '1' }, manager as unknown as EntityManager, 'key');
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), [
      'key',
      'deal.created',
      '{"dealId":"1"}',
    ]);
    expect(post).not.toHaveBeenCalled();
  });

  it('gửi sự kiện tới webhook với timeout', async () => {
    query.mockResolvedValueOnce([row]);
    post.mockResolvedValue({});
    await make('https://n.example/hook').drain();
    expect(post).toHaveBeenCalledWith(
      'https://n.example/hook',
      { event: 'deal.won', event_id: 'event-1', dealId: '1' },
      { timeout: 5000, headers: { 'Idempotency-Key': 'event-1' } },
    );
    expect(query.mock.calls[1][1][2]).toBe('sent');
  });

  it('đặt lịch retry khi bên nhận thông báo lỗi', async () => {
    query.mockResolvedValueOnce([row]);
    post.mockRejectedValue(new Error('down'));
    await make('https://n.example/hook').drain();
    expect(query.mock.calls[1][0]).toContain('attempts>=5');
    expect(query.mock.calls[1][1][2]).toBe(2);
  });

  it('ghi trạng thái demo riêng, không giả vờ đã gửi HTTP', async () => {
    query.mockResolvedValueOnce([row]);
    await make().drain();
    expect(query.mock.calls[1][1][2]).toBe('logged');
    expect(post).not.toHaveBeenCalled();
  });

  it('lỗi DB khi enqueue phải được báo cho transaction gọi', async () => {
    query.mockRejectedValueOnce(new Error('DB offline'));
    await expect(make().notify('deal.created', {})).rejects.toThrow('DB offline');
  });

  it('khôi phục được chu kỳ xử lý sau lỗi DB', async () => {
    query.mockRejectedValueOnce(new Error('DB offline'));
    const service = make();
    await service.drain();
    await service.drain();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
