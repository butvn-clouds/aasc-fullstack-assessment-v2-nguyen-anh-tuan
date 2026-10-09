import { AnalyticsStreamService } from './analytics-stream.service';
import { AnalyticsService } from './analytics.service';

describe('Luồng thống kê dùng chung', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('dùng một lần đọc cho nhiều kết nối và dừng khi không còn người nhận', async () => {
    const snapshot = jest.fn().mockResolvedValue({ conversion: { count: 1 }, campaigns: [] });
    const live = new AnalyticsStreamService({ snapshot } as unknown as AnalyticsService);
    const one = jest.fn(),
      two = jest.fn();
    const first = live.watch('7d').subscribe(one);
    const second = live.watch('7d').subscribe(two);
    await jest.advanceTimersByTimeAsync(0);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
    first.unsubscribe();
    await jest.advanceTimersByTimeAsync(1000);
    expect(snapshot).toHaveBeenCalledTimes(2);
    second.unsubscribe();
    await jest.advanceTimersByTimeAsync(3000);
    expect(snapshot).toHaveBeenCalledTimes(2);
    const third = live.watch('7d').subscribe();
    await jest.advanceTimersByTimeAsync(0);
    expect(snapshot).toHaveBeenCalledTimes(3);
    third.unsubscribe();
  });
  it('không chồng truy vấn chậm và phục hồi sau lỗi truy vấn', async () => {
    let reject!: (error: Error) => void;
    const snapshot = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue({ conversion: {}, campaigns: [] });
    const live = new AnalyticsStreamService({ snapshot } as unknown as AnalyticsService);
    const failure = jest.fn();
    live.watch('7d').subscribe({ error: failure });
    await jest.advanceTimersByTimeAsync(3000);
    expect(snapshot).toHaveBeenCalledTimes(1);
    reject(new Error('Lỗi truy vấn'));
    await jest.advanceTimersByTimeAsync(0);
    expect(failure).toHaveBeenCalledTimes(1);
    const next = live.watch('7d').subscribe();
    await jest.advanceTimersByTimeAsync(0);
    expect(snapshot).toHaveBeenCalledTimes(2);
    next.unsubscribe();
  });
  it('giới hạn số khoảng thời gian đang theo dõi', () => {
    const live = new AnalyticsStreamService({} as AnalyticsService);
    const subscriptions = Array.from({ length: 32 }, (_, i) => live.watch(`${i + 1}d`).subscribe());
    const error = jest.fn();
    live.watch('33d').subscribe({ error });
    expect(error).toHaveBeenCalledTimes(1);
    subscriptions.forEach((subscription) => subscription.unsubscribe());
  });
});
