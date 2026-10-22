/**
 * Shared retry-policy utility (Issue #952)
 *
 * Single source of truth for exponential-backoff configuration used by
 * both the Stellar submission helpers and the RabbitMQ queue processor.
 */
export interface RetryPolicyOptions {
  /** Base delay in milliseconds before the first retry. */
  baseDelayMs: number;
  /** Maximum number of attempts (including the initial attempt). */
  maxAttempts: number;
  /** Cap on computed delay, in milliseconds. */
  maxDelayMs: number;
  /** Exponential growth factor (e.g. 2 for doubling). */
  factor: number;
  /** Whether to add random jitter to the computed delay. */
  jitter: boolean;
}

export interface RetryPolicy extends RetryPolicyOptions {
  /**
   * Returns the delay in ms before attempt number `attempt` (1-indexed).
   * attempt=1 → baseDelayMs, attempt=2 → baseDelayMs*factor, …
   */
  nextAttemptMs(attempt: number): number;
  /** Returns true when no more retries should be made. */
  isExhausted(attempt: number): boolean;
}

/**
 * Factory: build a RetryPolicy from options.
 */
export function createRetryPolicy(opts: RetryPolicyOptions): RetryPolicy {
  return {
    ...opts,
    nextAttemptMs(attempt: number): number {
      const base = opts.baseDelayMs * Math.pow(opts.factor, attempt - 1);
      const capped = Math.min(base, opts.maxDelayMs);
      if (!opts.jitter) return capped;
      // Add up to 20 % random jitter
      return Math.floor(capped * (1 + 0.2 * Math.random()));
    },
    isExhausted(attempt: number): boolean {
      return attempt >= opts.maxAttempts;
    },
  };
}

/**
 * Default policy — matches the previous per-site constants.
 * baseDelay=1 s, maxAttempts=3, maxDelay=10 s, factor=2, no jitter.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = createRetryPolicy({
  baseDelayMs: 1_000,
  maxAttempts: 3,
  maxDelayMs: 10_000,
  factor: 2,
  jitter: false,
});

/**
 * Stellar-specific policy — same curve, slightly higher ceiling.
 */
export const STELLAR_RETRY_POLICY: RetryPolicy = createRetryPolicy({
  baseDelayMs: 1_000,
  maxAttempts: 3,
  maxDelayMs: 10_000,
  factor: 2,
  jitter: false,
});
