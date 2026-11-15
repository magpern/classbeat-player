// Keeps music commands in order around Start's playlist load (ADR 0001, amendment "Start loads the
// class playlist", issues #494 and #498). While a load is out, a later command (Pause, Resume, Next,
// a music control) is held and goes to the music app only after the load has answered, in the order
// given, so a Pause can never reach Spotify before the playlist request does. Each load has its own
// token: with two loads out, only when both have answered (or expired) does the held work go out.
// Pure: no timer and no I/O; the caller passes the clock and the send. A load that does not answer
// within `maxMs` no longer holds anything (the follower kills its own call well before that), so a
// Pause is never stuck.
import type { TransportAction } from "./transport.ts";

export interface LoadGate {
  /** Sends now, or holds the command while a load is out. */
  send(action: TransportAction): void;
  /** A load goes out at `now`: later commands wait for it. Returns that load's token. */
  hold(now: number): number;
  /** The load with this token answered. What was held goes out, in order, once no load is left open. */
  release(token: number): void;
  /** Drops the loads open longer than `maxMs`; if none is left, what was held goes out. */
  expire(now: number): void;
}

export function createLoadGate(deliver: (action: TransportAction) => void, maxMs: number): LoadGate {
  const open = new Map<number, number>(); // token -> time the load went out
  let held: TransportAction[] = [];
  let last = 0;
  const flush = (): void => {
    if (open.size > 0) return;
    const out = held;
    held = [];
    for (const a of out) deliver(a);
  };
  return {
    send(action) {
      if (open.size > 0) held.push(action);
      else deliver(action);
    },
    hold(now) {
      last += 1;
      open.set(last, now);
      return last;
    },
    release(token) {
      if (open.delete(token)) flush();
    },
    expire(now) {
      for (const [token, since] of open) if (now - since > maxMs) open.delete(token);
      flush();
    },
  };
}
