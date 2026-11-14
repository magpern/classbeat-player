// The rider's live session as a state machine (ADR 0007 sections 1 and 5; docs/design/rider.md,
// "In the class" and "Ending"). Pure: no DOM, no I/O, no clock of its own: every event carries the
// page's monotonic time `at` in milliseconds.
//
// - A `rider_state` with a lower (or the same) `seq` in the same run is ignored; one with a new
//   `run` replaces everything shown.
// - The countdown runs on between messages only while `status` is `running`, for at most 10 s past
//   the last state; while the instructor is away it holds where it was (`awayAt`) and does not run
//   on. When the instructor is back it carries on from there.
// - The phone's own connection dropped: "Reconnecting", the countdown runs on for 10 s, then goes.
// - The page receives and never sends: there is no command here (the socket sends only `hello`).
import type { Inbound, RiderState } from "./wire.ts";

export const LIVE_FOR_MS = 3000;
export const NOT_LIVE_FOR_MS = 10_000;

/** Close codes of the live process (backend live_wire_policy.py): hello refused, the session ended, a newer connection. */
export const CLOSE_REFUSED = 4401;
export const CLOSE_ENDED = 4403;
export const CLOSE_REPLACED = 4409;

export type Conn = "connecting" | "open" | "down";
/** removed: `ended` `dropped`; ended: the session ended; lapsed: the token was refused (away too long). */
export type Gone = "removed" | "ended" | "lapsed";

export interface Live {
  readonly conn: Conn;
  /** Welcomed on the connection now open. */
  readonly welcomed: boolean;
  /** Welcomed at least once with this token: the rider is in the class. */
  readonly joined: boolean;
  readonly hostIn: boolean;
  readonly state: RiderState | null;
  readonly stateAt: number;
  /** When the instructor went away while a state was shown: the countdown holds from there. */
  readonly awayAt: number | null;
  /** When the phone's own connection dropped, until it is welcomed again. */
  readonly downAt: number | null;
  readonly gone: Gone | null;
}

export type Event =
  | { readonly type: "connecting"; readonly at: number }
  | { readonly type: "opened"; readonly at: number }
  | { readonly type: "message"; readonly msg: Inbound; readonly at: number }
  | { readonly type: "closed"; readonly code: number; readonly at: number };

export const startLive = (): Live => ({ conn: "connecting", welcomed: false, joined: false, hostIn: false, state: null, stateAt: 0, awayAt: null, downAt: null, gone: null });

/** The instructor came or went. Away, the clock holds; back, it carries on from where it held. */
function host(l: Live, inNow: boolean, at: number): Live {
  if (!inNow) return { ...l, hostIn: false, awayAt: l.awayAt ?? (l.state ? at : null) };
  if (l.awayAt === null) return { ...l, hostIn: true };
  return { ...l, hostIn: true, stateAt: l.stateAt + Math.max(0, at - l.awayAt), awayAt: null };
}

function onState(l: Live, s: RiderState, at: number): Live {
  const old = l.state;
  if (old && old.run === s.run && s.seq <= old.seq) return l;
  // A state comes from the instructor's computer: it is in, and the clock is live again.
  return { ...l, state: s, stateAt: at, awayAt: null, hostIn: l.conn === "open" ? true : l.hostIn };
}

function onMessage(l: Live, m: Inbound, at: number): Live {
  switch (m.type) {
    case "welcome":
      return host({ ...l, conn: "open", welcomed: true, joined: true, downAt: null }, m.hostConnected, at);
    case "host_status":
      return host(l, m.connected, at);
    case "rider_state":
      return onState(l, m.state, at);
    case "ended":
      return { ...l, gone: m.reason === "dropped" ? "removed" : "ended", conn: "down" };
  }
}

/** The session after one event. Once gone, nothing but a new join changes it. */
export function step(l: Live, e: Event): Live {
  if (l.gone) return l;
  switch (e.type) {
    case "connecting":
    case "opened":
      return { ...l, conn: "connecting", welcomed: false };
    case "message":
      return onMessage(l, e.msg, e.at);
    case "closed":
      // The token refused on `hello`: it lapsed (5 minutes away, or never valid). Join again.
      if (e.code === CLOSE_REFUSED) return { ...l, gone: "lapsed", conn: "down" };
      // The session ended, or a newer connection with the same token took this one's place.
      if (e.code === CLOSE_ENDED || e.code === CLOSE_REPLACED) return { ...l, gone: "ended", conn: "down" };
      return { ...l, conn: "down", welcomed: false, downAt: l.downAt ?? e.at };
  }
}

/** Live: connected, welcomed, the instructor in and the last state fresh. */
export function isLive(l: Live, at: number): boolean {
  return !l.gone && l.conn === "open" && l.welcomed && l.hostIn && l.state !== null && at - l.stateAt <= LIVE_FOR_MS;
}

/** The instructor is away: told so on an open connection, or held since before the phone dropped. */
export const hostAway = (l: Live): boolean => (l.conn === "open" && l.welcomed && !l.hostIn) || l.awayAt !== null;

/** How far the class has run since the state arrived, as far as the phone may assume. */
export function runSince(l: Live, at: number): number {
  const s = l.state;
  if (!s || s.status !== "running") return 0;
  const until = l.awayAt ?? at;
  return Math.min(Math.max(0, until - l.stateAt), NOT_LIVE_FOR_MS);
}

/** The phone's own connection has been down for more than 10 s: the countdown goes. */
export const countdownGone = (l: Live, at: number): boolean => l.conn !== "open" && l.downAt !== null && at - l.downAt > NOT_LIVE_FOR_MS;
