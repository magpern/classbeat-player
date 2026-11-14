// What the presenter's riders panel shows (ADR 0007 sections 3 and 4; riders-panel.md). Pure.
// Built for the presenter window only: the shell answers it on the presenter's own channel and
// never sends it to the room window. Of a rider it holds the server's id (for Remove) and the
// nickname as typed, in the order they joined: no number, no time, no reading, no ranking.
import { MAX_RIDERS, NEW_CODES_PER_HOUR, HOUR_MS } from "./riders-model.ts";
import type { LiveModel } from "./session-types.ts";

export interface RiderRow {
  readonly id: string;
  /** Shown with textContent only, `dir="auto"`. */
  readonly nickname: string;
}

export interface RidersView {
  readonly shown: boolean;
  /** Join codes are on: the host is in, or reconnecting. */
  readonly on: boolean;
  /** The count as shown: a number, or "–" while join codes are off. */
  readonly count: string;
  /** The short state in the row and the head: "Reconnecting", "Locked", "Full", or null. */
  readonly word: string | null;
  /** The state line under the row or the head, or null. */
  readonly line: string | null;
  /** The list is the last one seen, greyed, while the host reconnects. */
  readonly dim: boolean;
  /** Whether Remove, Lock and New code act now. */
  readonly active: boolean;
  readonly locked: boolean;
  readonly lockText: string;
  readonly lockSub: string;
  readonly canNewCode: boolean;
  readonly newCodeSub: string;
  /** "Turn on join codes" acts (join codes off, a class open, nothing starting). */
  readonly canTurnOn: boolean;
  /** While join codes are off, or are being turned on, the line under the row. */
  readonly offLine: string | null;
  readonly rows: readonly RiderRow[];
}

export const RIDERS_NOTE = "Remove takes a rider out of the class. A removed rider can scan again until you lock joining or make a new code.";
export const RIDERS_EMPTY = "No riders yet. Riders scan the QR code on the room screen.";

export interface RidersFacts {
  readonly now: number;
  readonly classOpen: boolean;
}

/** Join codes are on once the host is in; a lost connection keeps them (the server holds the session). */
const ON = new Set(["live", "reconnecting"]);

export function ridersView(m: LiveModel, f: RidersFacts): RidersView {
  const on = ON.has(m.phase);
  const r = m.riders;
  const reconnecting = m.phase === "reconnecting" || (m.phase === "live" && r.replay !== null);
  const active = m.phase === "live" && r.replay === null;
  const full = on && r.list.length >= MAX_RIDERS;
  const made = active && r.made !== null && f.now < r.made.until ? r.made.code : null;
  const used = r.asked.filter((at) => at > f.now - HOUR_MS).length >= NEW_CODES_PER_HOUR;
  const word = !on ? null : reconnecting ? "Reconnecting" : r.locked ? "Locked" : full ? "Full" : null;
  let line: string | null = null;
  if (reconnecting) line = "Reconnecting. The list comes back when the connection does.";
  else if (made !== null) line = `New code ${made}. The room screen shows it now.`;
  else if (on && r.locked) line = "Joining is locked. Riders already in stay.";
  else if (full) line = "The class is full. More riders cannot join.";
  const starting = m.phase === "starting" || m.phase === "connecting";
  return {
    shown: f.classOpen || m.phase !== "idle",
    on,
    count: on ? String(r.list.length) : "–",
    word,
    line,
    dim: reconnecting,
    active,
    locked: r.locked,
    lockText: r.locked ? "Unlock joining" : "Lock joining",
    lockSub: r.locked ? "Joining is locked" : "Joining is open",
    canNewCode: active && !used,
    newCodeSub: used ? "10 an hour, used up" : "Old code stops working",
    canTurnOn: f.classOpen && (m.phase === "idle" || m.phase === "ended" || m.phase === "refused"),
    offLine: on ? null : starting ? "Turning on join codes" : "Join codes are off",
    rows: on ? r.list.map((x) => ({ id: x.id, nickname: x.nickname })) : [],
  };
}
