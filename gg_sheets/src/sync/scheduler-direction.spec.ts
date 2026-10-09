import { SyncSchedulerService } from './sync-scheduler.service';

describe('Hướng đồng bộ theo lịch', () => {
  it.each(['forward', 'reverse', 'both'])('chạy đúng hướng %s', async (direction) => {
    const order: string[] = [];
    const scheduler = new SyncSchedulerService(
      { get: (key, fallback) => (key === 'SYNC_DIRECTION' ? direction : fallback) } as any,
      {} as any,
      {
        run: async () => {
          order.push('forward');
        },
      } as any,
      {
        run: async () => {
          order.push('reverse');
        },
      } as any,
    );
    await (scheduler as any).runIfNotAlreadyRunning();
    expect(order).toEqual(direction === 'both' ? ['reverse', 'forward'] : [direction]);
  });
  it('từ chối hướng không hợp lệ trước khi đăng ký cron', () => {
    const scheduler = new SyncSchedulerService(
      { get: () => 'invalid' } as any,
      {} as any,
      {} as any,
    );
    expect(() => scheduler.onModuleInit()).toThrow('SYNC_DIRECTION');
  });
});
