// A reading is held for at most 3 s; after that the value is missing, never the last number.
export const FRESH_MS = 3000;

export interface Stamped<T> {
  readonly value: T;
  readonly at: number;
}

/** The value if it is at most 3 s old at `now` (and not from the future), else null. */
export function fresh<T>(sample: Stamped<T> | null | undefined, now: number): T | null {
  if (!sample) return null;
  const age = now - sample.at;
  return age >= 0 && age <= FRESH_MS ? sample.value : null;
}
