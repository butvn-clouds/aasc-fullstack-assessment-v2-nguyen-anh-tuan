import { retryWithBackoff, defaultIsRetryable } from './retry.util';

describe('retryWithBackoff', () => {
  it.each([-1, NaN, 1.5, 11])('rejects invalid retry budget %s', async (maxRetries) => {
    const work = jest.fn();
    await expect(retryWithBackoff(work, { maxRetries, baseDelayMs: 0 })).rejects.toThrow(
      'SYNC_MAX_RETRIES',
    );
    expect(work).not.toHaveBeenCalled();
  });
  it('caps backoff to one minute', async () => {
    const sleepFn = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockRejectedValueOnce({ status: 429 }).mockResolvedValue('ok');
    await retryWithBackoff(fn, { maxRetries: 1, baseDelayMs: 120000, sleepFn });
    expect(sleepFn).toHaveBeenCalledWith(60000);
  });
  it('tra ve ket qua ngay neu thanh cong lan dau, khong retry', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      sleepFn: async () => {},
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retry khi gap loi retryable, va thanh cong o lan thu 2', async () => {
    const error = { response: { status: 429 } };
    const fn = jest.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('recovered');
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10, sleepFn });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it('nem loi ngay lap tuc neu loi khong retryable', async () => {
    const error = { response: { status: 400 } };
    const fn = jest.fn().mockRejectedValue(error);

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10, sleepFn: async () => {} }),
    ).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('nem loi sau khi vuot qua so lan retry toi da', async () => {
    const error = { response: { status: 500 } };
    const fn = jest.fn().mockRejectedValue(error);

    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 5, sleepFn: async () => {} }),
    ).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(3); // 1 lan dau + 2 lan retry
  });

  it('goi onRetry voi so lan thu va delay tang dan', async () => {
    const error = { code: 'ETIMEDOUT' };
    const fn = jest.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('ok');
    const onRetry = jest.fn();

    await retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      sleepFn: async () => {},
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toBe(1);
  });
});

describe('defaultIsRetryable', () => {
  it('retry cho HTTP 429', () => {
    expect(defaultIsRetryable({ response: { status: 429 } })).toBe(true);
  });

  it('retry cho HTTP 5xx', () => {
    expect(defaultIsRetryable({ response: { status: 503 } })).toBe(true);
  });

  it('khong retry cho HTTP 400', () => {
    expect(defaultIsRetryable({ response: { status: 400 } })).toBe(false);
  });

  it('retry cho loi network timeout', () => {
    expect(defaultIsRetryable({ code: 'ETIMEDOUT' })).toBe(true);
  });
});
