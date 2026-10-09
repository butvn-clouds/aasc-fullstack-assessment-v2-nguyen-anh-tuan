import { RateLimiter } from './rate-limiter.util';

describe('RateLimiter', () => {
  let fakeNow: number;
  let dateSpy: jest.SpyInstance;

  beforeEach(() => {
    fakeNow = 1_000_000;
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it('cho phep goi ngay khi chua vuot gioi han', async () => {
    const sleepFn = jest.fn().mockImplementation(async (ms: number) => {
      fakeNow += ms;
    });
    const limiter = new RateLimiter(3, 1000, sleepFn);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(sleepFn).not.toHaveBeenCalled();
    expect(limiter.currentLoad).toBe(3);
  });

  it('cho (sleep) khi vuot qua gioi han, roi cho phep tiep tuc sau khi window troi qua', async () => {
    const sleepFn = jest.fn().mockImplementation(async (ms: number) => {
      fakeNow += ms; // gia lap thoi gian troi qua thay vi cho that
    });
    const limiter = new RateLimiter(2, 100, sleepFn);

    await limiter.acquire(); // t=1_000_000
    await limiter.acquire(); // t=1_000_000 (2 requests trong window)

    await limiter.acquire(); // vuot gioi han -> phai sleep truoc khi duoc chap nhan

    expect(sleepFn).toHaveBeenCalledTimes(1);
    expect(limiter.currentLoad).toBe(1); // 2 request cu da het han, chi con 1 request moi
  });
});
