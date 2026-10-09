export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  /** Ham kiem tra loi co dang retry duoc khong (vd: rate limit 429, network timeout) */
  isRetryable?: (error: any) => boolean;
  /** Cho phep override ham sleep, huu ich khi test */
  sleepFn?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: any, delayMs: number) => void;
}

/** Bộ chuyển tiếp dùng chung cho client CRM; không thử lại lỗi xác thực/dữ liệu. */
export function withRetry<T>(fn: () => Promise<T>, retries = 5, baseDelayMs = 500): Promise<T> {
  return retryWithBackoff(fn, {
    maxRetries: retries,
    baseDelayMs,
    isRetryable: (error) =>
      defaultIsRetryable(error) ||
      ['QUERY_LIMIT_EXCEEDED', 'OPERATION_TIME_LIMIT', 'TimeoutError'].includes(
        error?.code ?? error?.name,
      ) ||
      error instanceof TypeError,
  });
}

export function defaultIsRetryable(error: any): boolean {
  const status = error?.response?.status ?? error?.status;
  if (status === 429) return true; // rate limited
  if (status >= 500 && status < 600) return true; // server error
  if (
    error?.code === 'ECONNRESET' ||
    error?.code === 'ETIMEDOUT' ||
    error?.code === 'ECONNABORTED'
  ) {
    return true;
  }
  return false;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thuc thi ham `fn` voi co che retry va exponential backoff + jitter.
 * Dung cho cac loi tam thoi tu Google Sheets API va Bitrix24 API (rate limit, timeout, 5xx).
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    maxRetries,
    baseDelayMs,
    isRetryable = defaultIsRetryable,
    sleepFn = defaultSleep,
    onRetry,
  } = options;

  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10)
    throw new Error('SYNC_MAX_RETRIES phải là số nguyên từ 0 đến 10');
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0)
    throw new Error('SYNC_RETRY_BASE_DELAY_MS phải là số không âm');

  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt || !isRetryable(error)) {
        throw error;
      }
      const exponential = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * baseDelayMs;
      const delayMs = Math.min(exponential + jitter, 60_000);
      onRetry?.(attempt + 1, error, delayMs);
      await sleepFn(delayMs);
    }
  }
  throw lastError;
}
