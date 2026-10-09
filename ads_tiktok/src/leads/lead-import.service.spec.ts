import { LeadImportService } from './lead-import.service';
import { MockLeadFactory } from '../tiktok/mock-lead.factory';

describe('Nhập dữ liệu theo lô', () => {
  const events = { create: jest.fn((value) => value), save: jest.fn() };
  const queue = { add: jest.fn() };
  const service = new LeadImportService(events as never, queue as never);
  beforeEach(() => {
    jest.clearAllMocks();
    events.save.mockResolvedValue({ id: 'stored-id' });
    queue.add.mockResolvedValue({});
  });
  it('phân biệt dữ liệu hợp lệ, trùng, lỗi lưu, lỗi hàng đợi và dữ liệu sai', async () => {
    events.save
      .mockResolvedValueOnce({ id: 'one' })
      .mockRejectedValueOnce({ code: '23505' })
      .mockRejectedValueOnce(new Error('Mất kết nối cơ sở dữ liệu'))
      .mockResolvedValueOnce({ id: 'four' });
    queue.add.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Redis gián đoạn'));
    const payloads = Array.from({ length: 4 }, () => new MockLeadFactory().create());
    const result = await service.importBatch([...payloads, { event_id: 'bad' }, null]);
    expect(result).toMatchObject({ queued: 1, skipped: 3, failed: 1, pendingRecovery: 1 });
    expect(result.results.map((row) => row.status)).toEqual([
      'queued',
      'duplicate',
      'failed',
      'pending_recovery',
      'invalid',
      'invalid',
    ]);
    expect(queue.add).toHaveBeenLastCalledWith(
      'process',
      { webhookEventId: 'four' },
      expect.objectContaining({ jobId: 'four' }),
    );
  });
  it('từ chối nội dung sai dạng và giới hạn kích thước lô', async () => {
    await expect(service.importBatch(null)).rejects.toThrow('1000');
    await expect(service.importBatch(Array(1001).fill({}))).rejects.toThrow('1000');
    expect((await service.importBatch([])).results).toEqual([]);
    expect(events.save).not.toHaveBeenCalled();
  });
  it('kiểm tra sự kiện tương tác và mặc định loại sự kiện khách hàng', async () => {
    const payload = new MockLeadFactory().create();
    const { event: _event, ...withoutEvent } = payload;
    const result = await service.importBatch([
      withoutEvent,
      { event_id: 'i1', event: 'user.interact', lead_data: { ttclid: 'click' } },
      { event_id: 'i2', event: 'form.complete', ttclid: 'click' },
      { event_id: 'i3', event: 'unknown', ttclid: 'click' },
      { event_id: 'i4', event: 'user.interact', lead_data: {} },
      { event_id: '' },
    ]);
    expect(result.queued).toBe(3);
    expect(result.skipped).toBe(3);
  });
});
