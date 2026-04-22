// apps/api/tests/unit/resilience.test.ts
import { describe, it, expect, vi } from 'vitest';
import { withRetry, CircuitBreaker, withTimeout } from '../../src/lib/resilience.js';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure then succeeds', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      if (++calls < 3) throw new Error('temporary error');
      return 'success';
    });
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after max attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 401 errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 401 Unauthorized'));
    await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1); // no retry
  });

  it('calls onRetry callback', async () => {
    let calls = 0;
    const onRetry = vi.fn();
    const fn = vi.fn().mockImplementation(async () => {
      if (++calls < 2) throw new Error('error');
      return 'ok';
    });
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    const cb = new CircuitBreaker('test', 3, 100);
    expect(cb.status().state).toBe('closed');
  });

  it('opens after threshold failures', async () => {
    const cb = new CircuitBreaker('test', 3, 1000);
    const failing = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await cb.call(failing).catch(() => {});
    }
    expect(cb.status().state).toBe('open');
  });

  it('returns fallback when open', async () => {
    const cb = new CircuitBreaker('test', 1, 10_000);
    await cb.call(() => Promise.reject(new Error('fail'))).catch(() => {});

    const result = await cb.call(
      () => Promise.resolve('live'),
      () => 'fallback'
    );
    expect(result).toBe('fallback');
  });

  it('transitions to half-open after reset time', async () => {
    const cb = new CircuitBreaker('test', 1, 50); // 50ms reset
    await cb.call(() => Promise.reject(new Error('fail'))).catch(() => {});
    expect(cb.status().state).toBe('open');

    await new Promise(r => setTimeout(r, 60));
    // Next call should trigger half-open
    await cb.call(() => Promise.resolve('ok')).catch(() => {});
    // After success in half-open, should become closed or stay half-open
    expect(['closed', 'half-open']).toContain(cb.status().state);
  });

  it('resets correctly', () => {
    const cb = new CircuitBreaker('test', 1, 1000);
    cb.reset();
    expect(cb.status()).toEqual({ name: 'test', state: 'closed', failures: 0 });
  });
});

describe('withTimeout', () => {
  it('resolves before timeout', async () => {
    const result = await withTimeout(() => Promise.resolve('fast'), 1000);
    expect(result).toBe('fast');
  });

  it('rejects after timeout', async () => {
    const slow = new Promise(r => setTimeout(() => r('slow'), 500));
    await expect(withTimeout(() => slow as any, 50, 'timeout!')).rejects.toThrow('timeout!');
  });
});
