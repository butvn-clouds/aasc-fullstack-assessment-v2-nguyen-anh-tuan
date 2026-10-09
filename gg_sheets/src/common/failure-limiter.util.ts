/** Bộ đếm lỗi xác thực theo khóa (thường là IP) trong cửa sổ trượt, chống dò API key/token bằng brute force.
 * Nằm trong bộ nhớ và có giới hạn kích thước để kẻ tấn công không làm đầy RAM bằng nhiều IP giả. */
export class FailureLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 5 * 60_000,
    private readonly maxKeys = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.maxFailures;
  }

  /** Số giây còn phải chờ để được thử lại (dùng cho header Retry-After). */
  retryAfterSeconds(key: string): number {
    const list = this.recent(key);
    if (list.length < this.maxFailures) return 0;
    return Math.max(1, Math.ceil((list[0] + this.windowMs - this.now()) / 1000));
  }

  fail(key: string): void {
    if (this.hits.size >= this.maxKeys && !this.hits.has(key)) {
      // Đầy: bỏ khóa cũ nhất để giữ bộ nhớ có giới hạn.
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
