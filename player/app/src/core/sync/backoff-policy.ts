// When the app asks the player API again (ADR 0002, section 10: 60 requests a minute per device
// token, 600 for class documents). Pure. Offline is a normal state: the app keeps playing its
// cache and only asks less often.

/** Between two syncs that went well. */
export const SYNC_EVERY_MS = 5 * 60_000;
/** The first wait after a failure; each further failure doubles it, up to the cap. */
export const FIRST_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 30 * 60_000;
/** Never sooner than this after a 429, whatever Retry-After says. */
export const MIN_RETRY_AFTER_MS = 1000;
/** The longest a Retry-After is waited (the edge also caps it at an hour). */
export const MAX_RETRY_AFTER_MS = 60 * 60_000;

/** The wait after the `failures`-th failure in a row (1 or more). */
export function backoffMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  // 2^20 is far past the cap; capping the exponent keeps the number finite.
  return Math.min(FIRST_BACKOFF_MS * 2 ** Math.min(n - 1, 20), MAX_BACKOFF_MS);
}

/**
 * The wait after an answer that says "later": a 429's Retry-After when it gave one, held within
 * bounds; otherwise (no Retry-After, a 5xx, no answer) the doubling backoff.
 */
export function retryWaitMs(failures: number, retryAfterMs: number | null): number {
  if (retryAfterMs === null) return backoffMs(failures);
  return Math.min(Math.max(retryAfterMs, MIN_RETRY_AFTER_MS), MAX_RETRY_AFTER_MS);
}
