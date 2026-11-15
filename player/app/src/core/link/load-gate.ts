// Keeps music commands in order around Start's playlist load (ADR 0001, amendment "Start loads the
// class playlist", issue #494). While a load is out, a later command (Pause, Resume, Next, a music
// control) is held and goes to the music app only after the load has answered, in the order given,
// so a Pause can never reach Spotify before the playlist request does. Pure: no timer and no I/O;
// the caller passes the clock and the send. A load that does not answer within `maxMs` no longer
// holds anything (the follower kills its own call well before that), so a Pause is never stuck.
import type { TransportAction } from "./transport.ts";

export interface LoadGate {
  /** Sends now, or holds the command while a load is out. */
  send(action: TransportAction): void;
  /** A load goes out at `now`: later commands wait for it. */
  hold(now: number): void;
  /** The load answered: what was held goes out, in order. */
  release(): void;
  /** Releases a hold that has lasted longer than `maxMs`. */
  expire(now: number): void;
}

export function createLoadGate(deliver: (action: TransportAction) => void, maxMs: number): LoadGate {
  let held: TransportAction[] | null = null;
  let since = 0;
  const release = (): void => {
    const out = held ?? [];
    held = null;
    for (const a of out) deliver(a);
  };
  return {
    send(action) {
      if (held !== null) held.push(action);
      else deliver(action);
    },
    hold(now) {
      held ??= [];
      since = now;
    },
    release,
    expire(now) {
      if (held !== null && now - since > maxMs) release();
    },
  };
}
