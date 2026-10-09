import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TikTokEventsService } from './tiktok-events.service';

describe('Conversion outbox', () => {
  function setup(attempts = 0) {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'outbox-1', payload: { event: 'CompletePayment' }, attempts }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    const ds = { transaction: jest.fn((work) => work({ query })), query: jest.fn().mockResolvedValue([]) };
    const service = new TikTokEventsService(
      { get: (key: string) => (key === 'TIKTOK_EVENTS_MOCK' ? 'true' : '') } as unknown as ConfigService,
      ds as unknown as DataSource,
    );
    return { query, ds, service };
  }
  it('persists a stable conversion key for repeat deliveries', async () => {
    const { service, ds } = setup();
    await service.queueConversion('deal-1-won', { event: 'CompletePayment', value: 123 });
    expect(ds.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), [
      'deal-1-won',
      JSON.stringify({ event: 'CompletePayment', value: 123, event_id: 'deal-1-won' }),
    ]);
  });
  it('marks delivered conversions sent', async () => {
    const { service, query } = setup();
    jest.spyOn(service, 'sendConversion').mockResolvedValue({ mock: false });
    await service.drain();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='sent'"), ['outbox-1']);
  });
  it('conversion giả lập có trạng thái mocked, không có thời điểm gửi thật', async () => {
    const { service, query } = setup();
    await service.drain();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='mocked', sent_at=NULL"), ['outbox-1']);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("status='sent'"), expect.anything());
  });
  it('thiếu cấu hình thật giữ cơ chế retry, không đánh dấu sent', async () => {
    const { query, ds } = setup();
    const service = new TikTokEventsService({ get: () => '' } as unknown as ConfigService, ds as unknown as DataSource);
    await service.drain();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("THEN 'failed'"), [
      'outbox-1',
      2,
      expect.stringContaining('chưa gửi conversion'),
    ]);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("status='sent'"), expect.anything());
  });
  it.each([0, 4, 15])('schedules bounded retry after failure with attempts=%d', async (attempts) => {
    const { service, query } = setup(attempts);
    jest.spyOn(service, 'sendConversion').mockRejectedValue(new Error('offline'));
    await service.drain();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("THEN 'failed'"), [
      'outbox-1',
      Math.min(300, 2 ** (attempts + 1)),
      'offline',
    ]);
  });
  it('resets the running flag after a database error', async () => {
    const { service, ds } = setup();
    ds.transaction.mockRejectedValueOnce(new Error('database unavailable'));
    await service.drain();
    await service.drain();
    expect(ds.transaction).toHaveBeenCalledTimes(3);
  });
});
