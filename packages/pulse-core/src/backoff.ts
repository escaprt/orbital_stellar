// backoff.ts
// Shared full-jitter exponential backoff used by both the Horizon reconnect
// path (EventEngine) and the Soroban reconnect path (SorobanSubscriber).

/**
 * Return a full-jitter exponential backoff delay in milliseconds.
 *
 * @param attempt - 1-based retry attempt number.
 * @param initialDelayMs - Base delay for the first attempt.
 * @param maxDelayMs - Upper bound on the exponential delay before jitter.
 * @returns A random delay in `[0, min(initialDelayMs * 2^(attempt-1), maxDelayMs))`.
 */
export function fullJitterBackoffMs(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
): number {
  const exponentialDelay = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
  return Math.floor(Math.random() * exponentialDelay);
}
