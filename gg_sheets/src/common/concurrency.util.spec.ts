import { mapWithConcurrency } from './concurrency.util';

describe('mapWithConcurrency', () => {
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid concurrency %s', async (limit) => {
    await expect(mapWithConcurrency([1], limit, async (n) => n)).rejects.toThrow('số nguyên dương');
  });
  it('preserves input order in the results regardless of completion order', async () => {
    const delays = [30, 10, 20];
    const result = await mapWithConcurrency(
      delays,
      3,
      (ms, i) => new Promise<number>((resolve) => setTimeout(() => resolve(i), ms)),
    );

    expect(result).toEqual([0, 1, 2]);
  });

  it('never runs more than `limit` items concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 2, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return item;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('handles an empty array without hanging', async () => {
    const result = await mapWithConcurrency([], 5, async (x) => x);
    expect(result).toEqual([]);
  });

  it('propagates an error from any single call', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
