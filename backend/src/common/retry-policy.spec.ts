import { createRetryPolicy, DEFAULT_RETRY_POLICY } from './retry-policy';

describe('createRetryPolicy', () => {
  const policy = createRetryPolicy({
    baseDelayMs: 1000,
    maxAttempts: 3,
    maxDelayMs: 10_000,
    factor: 2,
    jitter: false,
  });

  it('returns baseDelayMs on attempt 1', () => {
    expect(policy.nextAttemptMs(1)).toBe(1000);
  });

  it('doubles delay on attempt 2', () => {
    expect(policy.nextAttemptMs(2)).toBe(2000);
  });

  it('caps at maxDelayMs', () => {
    const p = createRetryPolicy({ baseDelayMs: 5000, maxAttempts: 5, maxDelayMs: 8000, factor: 2, jitter: false });
    expect(p.nextAttemptMs(3)).toBe(8000); // 5000*4=20000 capped to 8000
  });

  it('isExhausted returns false below maxAttempts', () => {
    expect(policy.isExhausted(2)).toBe(false);
  });

  it('isExhausted returns true at maxAttempts', () => {
    expect(policy.isExhausted(3)).toBe(true);
  });

  it('DEFAULT_RETRY_POLICY has expected shape', () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(3);
    expect(DEFAULT_RETRY_POLICY.baseDelayMs).toBe(1000);
  });

  it('backoff curve identical for two policies built with same config', () => {
    const a = createRetryPolicy({ baseDelayMs: 500, maxAttempts: 4, maxDelayMs: 5000, factor: 3, jitter: false });
    const b = createRetryPolicy({ baseDelayMs: 500, maxAttempts: 4, maxDelayMs: 5000, factor: 3, jitter: false });
    for (let i = 1; i <= 4; i++) {
      expect(a.nextAttemptMs(i)).toBe(b.nextAttemptMs(i));
    }
  });
});
