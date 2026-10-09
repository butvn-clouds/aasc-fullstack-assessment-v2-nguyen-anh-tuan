/** Retry-After nhận số giây hoặc ngày HTTP; bỏ qua giá trị không hợp lệ. */
export function retryAfterMs(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  const delay = /^\d+(\.\d+)?$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  return Number.isFinite(delay) && delay >= 0 ? Math.ceil(delay) : undefined;
}
