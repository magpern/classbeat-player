// The phone's live session as a state machine (ADR 0005 sections 5 and 6; docs/design/companion.md,
// "States" and "After a press"). Pure: no DOM, no I/O, no clock of its own: every event carries
// the page's monotonic time `at` in milliseconds.
//
// - The page shows what the host last published and never changes it as if a command had worked
//   before the host says so. A state with a lower (or the same) `seq` in the same run is ignored;
//   one with a new `run` replaces everything shown.
// - A press is one `command` with a new `id`, the current `run` and `basis`. It is pending until
//   its `ack` or a later state; never queued while not connected and never resent by the page.
//   No `ack` within 3 s: the key returns and a notice says so; an `ack` that comes later wins.
import { allows } from "./state-check.ts";
import type { Action, CompanionState } from "./state-check.ts";
import type { AckReason, CommandParts, Inbound } from "./wire.ts";

export const LIVE_FOR_MS = 3000;
export const NOT_LIVE_FOR_MS = 10_000;
export const ACK_WITHIN_MS = 3000;
export const NOTE_MS = 3000;
export const NOTICE_MS = 4000;
const LATE_KEPT = 8;

/** Close codes of the live process (backend live_wire_policy.py): the token refused, the session ended, a newer connection. */
export const CLOSE_REFUSED = 4401;
export const CLOSE_ENDED = 4403;
export const CLOSE_REPLACED = 4409;

export type Conn = "connecting" | "open" | "down";
export type Gone = "dropped" | "ended";
export type Delta = 5000 | -5000;

export interface Pending {
  readonly id: string;
  readonly action: Action;
  readonly deltaMs?: Delta;
  /** What skip did when pressed: the next song while following, else the next interval. */
  readonly skipTo: "song" | "interval";
  readonly basis: number;
  readonly at: number;
  /** The key shows "Sending…" until the ack or a later state. */
  readonly sending: boolean;
}

export type Flash =
  | { readonly kind: "done"; readonly press: Pending; readonly until: number }
  | { readonly kind: "refused"; readonly reason: AckReason; readonly until: number }
  | { readonly kind: "no_answer"; readonly until: number };

export interface Live {
  readonly conn: Conn;
  readonly welcomed: boolean;
  readonly hostIn: boolean;
  readonly state: CompanionState | null;
  readonly stateAt: number;
  readonly pending: readonly Pending[];
  /** Ids whose 3 s ran out: a late `ack` for one of them still shows its answer. */
  readonly late: readonly Pending[];
  /** The note in the top line after an applied command (3 s). */
  readonly note: Flash | null;
  /** The notice in skip's place after a refusal or no answer (4 s). */
  readonly notice: Flash | null;
  readonly gone: Gone | null;
}

export type Event =
  | { readonly type: "connecting"; readonly at: number }
  | { readonly type: "opened"; readonly at: number }
  | { readonly type: "message"; readonly msg: Inbound; readonly at: number }
  | { readonly type: "closed"; readonly code: number; readonly at: number }
  | { readonly type: "tick"; readonly at: number };

export const startLive = (): Live => ({ conn: "connecting", welcomed: false, hostIn: false, state: null, stateAt: 0, pending: [], late: [], note: null, notice: null, gone: null });

function onState(l: Live, s: CompanionState, at: number): Live {
  const old = l.state;
  if (old && old.run === s.run && s.seq <= old.seq) return l;
  if (!old || old.run !== s.run) return { ...l, state: s, stateAt: at, pending: [], late: [], note: null, notice: null };
  const pending = l.pending.map((p) => (p.sending && s.seq > p.basis ? { ...p, sending: false } : p));
  // A state that comes after "No answer" replaces the notice at once.
  const notice = l.notice?.kind === "no_answer" ? null : l.notice;
  return { ...l, state: s, stateAt: at, pending, notice };
}

function onAck(l: Live, id: string, result: string, reason: AckReason | null, at: number): Live {
  const press = l.pending.find((p) => p.id === id) ?? l.late.find((p) => p.id === id);
  if (!press) return l;
  const pending = l.pending.filter((p) => p.id !== id);
  const late = l.late.filter((p) => p.id !== id);
  const notice = l.notice?.kind === "no_answer" ? null : l.notice;
  if (result === "refused" && reason) return { ...l, pending, late, notice: { kind: "refused", reason, until: at + NOTICE_MS } };
  return { ...l, pending, late, notice, note: { kind: "done", press, until: at + NOTE_MS } };
}

function onMessage(l: Live, m: Inbound, at: number): Live {
  switch (m.type) {
    case "welcome":
      return { ...l, conn: "open", welcomed: true, hostIn: m.hostConnected };
    case "host_status":
      return { ...l, hostIn: m.connected };
    case "companion_state":
      return onState(l, m.state, at);
    case "ack":
      return onAck(l, m.id, m.result, m.reason, at);
    case "ended":
      return { ...l, gone: m.reason === "dropped" ? "dropped" : "ended", pending: [], conn: "down" };
  }
}

function onTick(l: Live, at: number): Live {
  const due = l.pending.filter((p) => at - p.at >= ACK_WITHIN_MS);
  let next = l;
  if (due.length) {
    next = { ...l, pending: l.pending.filter((p) => !due.includes(p)), late: [...l.late, ...due].slice(-LATE_KEPT), notice: { kind: "no_answer", until: at + NOTICE_MS } };
  }
  if (next.note && at >= next.note.until) next = { ...next, note: null };
  if (next.notice && at >= next.notice.until) next = { ...next, notice: null };
  return next;
}

/** The session after one event. Once gone (dropped or ended), nothing but a new session changes it. */
export function step(l: Live, e: Event): Live {
  if (l.gone) return l;
  switch (e.type) {
    case "connecting":
      return { ...l, conn: "connecting", welcomed: false };
    case "opened":
      return { ...l, conn: "connecting" };
    case "message":
      return onMessage(l, e.msg, e.at);
    case "closed":
      // A token refused on `hello`, the session ended, or a newer connection with the same token.
      if (e.code === CLOSE_REFUSED || e.code === CLOSE_ENDED || e.code === CLOSE_REPLACED) return { ...l, gone: "ended", pending: [], conn: "down" };
      // Any other close is a dropped connection: reconnecting, and no command waits for it.
      return { ...l, conn: "down", welcomed: false, pending: [] };
    case "tick":
      return onTick(l, e.at);
  }
}

/** Whether the page can steer now: connected, welcomed, the host in and the last state fresh. */
export function isLive(l: Live, at: number): boolean {
  return !l.gone && l.conn === "open" && l.welcomed && l.hostIn && l.state !== null && at - l.stateAt <= LIVE_FOR_MS;
}

export const isSending = (l: Live, action: Action, deltaMs?: Delta): boolean =>
  l.pending.some((p) => p.sending && p.action === action && p.deltaMs === deltaMs);

/**
 * A press of a live key: the command to send and the session with it pending, or null when the
 * key does nothing now (not live, not in `allowed`, the class ended, or the same key still sending).
 */
export function press(l: Live, action: Action, id: string, at: number, deltaMs?: Delta): { live: Live; command: CommandParts } | null {
  const s = l.state;
  if (!s || !isLive(l, at) || s.status === "ended" || !allows(s, action)) return null;
  if ((action === "nudge") !== (deltaMs !== undefined)) return null;
  if (isSending(l, action, deltaMs) || l.pending.some((p) => p.id === id)) return null;
  const pending: Pending = { id, action, ...(deltaMs !== undefined ? { deltaMs } : {}), skipTo: s.link.mode === "following" ? "song" : "interval", basis: s.seq, at, sending: true };
  const command: CommandParts = { id, run: s.run, basis: s.seq, action, ...(deltaMs !== undefined ? { deltaMs } : {}) };
  return { live: { ...l, pending: [...l.pending, pending] }, command };
}
