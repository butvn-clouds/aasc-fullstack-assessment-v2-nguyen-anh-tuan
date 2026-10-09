import { retryAfterMs } from './retry-after';

describe('Retry-After', () => {
  it('đọc số giây và ngày HTTP', () => {
    expect(retryAfterMs('3')).toBe(3000);
    expect(retryAfterMs('0.5')).toBe(500);
    expect(retryAfterMs('Thu, 01 Jan 2026 00:00:05 GMT', Date.parse('2026-01-01T00:00:00Z'))).toBe(5000);
  });
  it.each([undefined, null, '', 'invalid', '-1', 'Wed, 01 Jan 2020 00:00:00 GMT'])('bỏ giá trị sai %s', (value) => {
    expect(retryAfterMs(value)).toBeUndefined();
  });
});
