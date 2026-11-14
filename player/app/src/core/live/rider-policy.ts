// When the host publishes rider_state (ADR 0007 section 8, item 5): at once on a change of status
// or interval, otherwise every 2 s, and never more than 2 in any second. Pure: it says whether to
// publish now and when to ask again; the caller publishes and records it.
export const RIDER_HEARTBEAT_MS = 2000;
export const RIDER_WINDOW_MS = 1000;
export const RIDER_MAX_PER_WINDOW = 2;

/** What a change is judged on: the state's status and its interval's index. */
export interface RiderKey {
  readonly status: string;
  readonly index: number;
}

export interface RiderPolicy {
  /** Publish times within the last window, oldest first. */
  readonly sent: readonly number[];
  readonly last: { readonly at: number; readonly key: RiderKey } | null;
}

export const newRiderPolicy = (): RiderPolicy => ({ sent: [], last: null });

const inWindow = (p: RiderPolicy, now: number): readonly number[] => p.sent.filter((at) => at > now - RIDER_WINDOW_MS);
const sameKey = (a: RiderKey, b: RiderKey): boolean => a.status === b.status && a.index === b.index;

/** The earliest time at or after `now` that the window has room. */
function roomAt(p: RiderPolicy, now: number): number {
  const sent = inWindow(p, now);
  return sent.length < RIDER_MAX_PER_WINDOW ? now : sent[sent.length - RIDER_MAX_PER_WINDOW] + RIDER_WINDOW_MS;
}

/** When a state with `key` is due: now for a first or changed one, else one heartbeat after the last. */
function dueAt(p: RiderPolicy, key: RiderKey, now: number): number {
  if (p.last === null || !sameKey(p.last.key, key)) return now;
  return Math.max(now, p.last.at + RIDER_HEARTBEAT_MS);
}

/** The time to publish a state with `key` next (`now` or later). */
export const riderWakeAt = (p: RiderPolicy, key: RiderKey, now: number): number => Math.max(dueAt(p, key, now), roomAt(p, now));

/** True when a state with `key` is to be published at `now`. */
export const riderDue = (p: RiderPolicy, key: RiderKey, now: number): boolean => riderWakeAt(p, key, now) <= now;

/** The policy after publishing a state with `key` at `now`. */
export const riderPublished = (p: RiderPolicy, key: RiderKey, now: number): RiderPolicy => ({ sent: [...inWindow(p, now), now], last: { at: now, key } });
