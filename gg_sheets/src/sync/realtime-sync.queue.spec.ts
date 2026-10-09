import { RealtimeSyncService } from './realtime-sync.service';

describe('webhook queue (async ACK, coalescing, retry)', () => {
  const ok = { errors: 0, pulledDown: 1 };
  const make = (run: jest.Mock) => new RealtimeSyncService({ run } as any, { get: () => 0 } as any); // retry delay = 0

  it('returns immediately without waiting for the sync to finish', async () => {
    let finish!: (v: unknown) => void;
    const run = jest.fn(() => new Promise((resolve) => (finish = resolve)));
    const svc = make(run);
    expect(svc.enqueue('1')).toEqual({ queued: true, pending: 1 }); // trả về khi việc nặng chưa xong
    await Promise.resolve();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith('1');
    finish(ok);
    await svc.idle();
  });

  it('coalesces duplicate IDs and merges a burst of different IDs into one full pass', async () => {
    const run = jest.fn().mockResolvedValue(ok);
    const svc = make(run);
    for (const id of ['1', '1', '2', '3', '2']) svc.enqueue(id);
    await svc.idle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(undefined); // một lượt kéo toàn Sheet thay vì 3 lần
  });

  it('retries transient failures then succeeds', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('ETIMEDOUT')).mockResolvedValue(ok);
    const svc = make(run);
    svc.enqueue('7');
    await svc.idle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith('7');
  });

  it('gives up after 3 attempts and stays usable for later events', async () => {
    const run = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const svc = make(run);
    svc.enqueue('9');
    await svc.idle();
    expect(run).toHaveBeenCalledTimes(3);
    run.mockReset().mockResolvedValue(ok);
    svc.enqueue('10');
    await svc.idle();
    expect(run).toHaveBeenCalledWith('10');
  });

  it('treats a run that reports row errors as a failure to retry', async () => {
    const run = jest.fn().mockResolvedValueOnce({ errors: 1, pulledDown: 0 }).mockResolvedValue(ok);
    const svc = make(run);
    svc.enqueue('5');
    await svc.idle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('collapses to a single full pass when too many distinct IDs are pending', async () => {
    const run = jest.fn().mockResolvedValue(ok);
    const svc = make(run);
    for (let i = 1; i <= 600; i++) svc.enqueue(String(i));
    await svc.idle();
    expect(run.mock.calls.length).toBeLessThanOrEqual(2);
    expect(run.mock.calls.every(([id]) => id === undefined)).toBe(true);
  });
});
