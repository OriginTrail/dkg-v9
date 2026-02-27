import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../src/retry.js';

describe('withRetry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient failure then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('reset'))
      .mockResolvedValue('ok');

    const onRetry = vi.fn();
    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      onRetry,
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent'));

    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 10 }))
      .rejects.toThrow('persistent');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately for non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));

    await expect(withRetry(fn, {
      maxAttempts: 5,
      baseDelayMs: 10,
      isRetryable: () => false,
    })).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects maxDelayMs cap', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const delays: number[] = [];
    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 100_000,
      maxDelayMs: 50,
      jitter: 0,
      onRetry: (_attempt, delay) => { delays.push(delay); },
    });

    expect(delays[0]).toBeLessThanOrEqual(50);
  });
});
