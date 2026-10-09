/**
 * Rate limiter don gian dang "sliding window": gioi han so lan goi trong 1 khoang thoi gian.
 * Dung de tuan thu quota cua Google Sheets API (mac dinh 60 requests/phut/user)
 * va Bitrix24 REST API (mac dinh ~2 requests/giay cho webhook).
 */
export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly sleepFn: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 5;
      await this.sleepFn(waitMs);
      return this.acquire();
    }

    this.timestamps.push(Date.now());
  }

  get currentLoad(): number {
    const now = Date.now();
    return this.timestamps.filter((t) => now - t < this.windowMs).length;
  }
}
