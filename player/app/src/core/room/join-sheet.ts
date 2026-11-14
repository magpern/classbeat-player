// When the room screen's join sheet shows (room-join.md, "Where the codes show", "The new code").
// Pure: the clock's state and the join code in, whether the sheet is open and whether its "New
// code" plate shows out; the page owns the timers and asks again at `sheetWakeAt`.
// - Before the start, with a code, it opens by itself and stays until Start, when it closes at
//   once; J (or Esc) closes it then, and J brings it back.
// - During the class J opens it for at most 20 s, J or Esc closes it sooner; the clock goes on.
// - With no code (join codes off, starting, ended, not paired) there is no sheet and J does nothing.
// - A new code while the sheet is open shows the plate for 10 s; a new code never opens it.
// The sheet holds the join code only: nothing about a rider and never a control code.
import type { ClockStatus } from "./band-view.ts";

/** The longest the sheet stays open during a class. */
export const SHEET_RUNNING_MS = 20_000;
/** How long the "New code" plate shows. */
export const PLATE_MS = 10_000;

export interface JoinSheet {
  readonly open: boolean;
  /** When an open sheet closes by itself (during a class), or null. */
  readonly until: number | null;
  /** The instructor closed it before the start: it does not open by itself again until the code is gone. */
  readonly dismissed: boolean;
  readonly code: string | null;
  readonly status: ClockStatus | null;
  /** When the "New code" plate goes, or null when it is not shown. */
  readonly plateUntil: number | null;
}

export const NO_SHEET: JoinSheet = { open: false, until: null, dismissed: false, code: null, status: null, plateUntil: null };

export interface SheetFacts {
  readonly status: ClockStatus | null;
  /** The join code while the phone remote's slot is on, else null. */
  readonly code: string | null;
}

const hasCode = (f: SheetFacts): f is { status: ClockStatus; code: string } => f.code !== null && f.status !== null && f.status !== "ended";
const closed = (s: JoinSheet): JoinSheet => ({ ...s, open: false, until: null, plateUntil: null });

/** A new frame or slot: the sheet opens before the start, closes at the start, and marks a new code. */
export function sheetFacts(s: JoinSheet, f: SheetFacts, now: number): JoinSheet {
  if (!hasCode(f)) return { ...NO_SHEET, status: f.status };
  const before = f.status === "ready";
  let next: JoinSheet = { ...s, code: f.code, status: f.status };
  if (before) next = s.dismissed ? next : { ...next, open: true, until: null };
  else if (s.status === "ready" || s.status === null) next = closed(next);
  if (!next.open) return { ...next, plateUntil: null };
  const changed = s.code !== null && s.code !== f.code;
  return changed ? { ...next, plateUntil: now + PLATE_MS } : next;
}

/** J: toggles before the start, opens for 20 s during the class; taken only when there is a code. */
export function sheetJoin(s: JoinSheet, now: number): { readonly sheet: JoinSheet; readonly taken: boolean } {
  if (s.code === null || s.status === null || s.status === "ended") return { sheet: s, taken: false };
  const before = s.status === "ready";
  if (s.open) return { sheet: { ...closed(s), dismissed: s.dismissed || before }, taken: true };
  return { sheet: { ...s, open: true, until: before ? null : now + SHEET_RUNNING_MS }, taken: true };
}

/** Esc: closes an open sheet (taken), else leaves the key to the band. */
export function sheetEscape(s: JoinSheet): { readonly sheet: JoinSheet; readonly taken: boolean } {
  if (!s.open) return { sheet: s, taken: false };
  return { sheet: { ...closed(s), dismissed: s.dismissed || s.status === "ready" }, taken: true };
}

/** Time passes: the 20 s run out, the plate goes. */
export function sheetTick(s: JoinSheet, now: number): JoinSheet {
  if (s.open && s.until !== null && now >= s.until) return closed(s);
  if (s.plateUntil !== null && now >= s.plateUntil) return { ...s, plateUntil: null };
  return s;
}

/** When `sheetTick` will next change something, or null. */
export function sheetWakeAt(s: JoinSheet): number | null {
  const at = [s.open ? s.until : null, s.plateUntil].filter((x): x is number => x !== null);
  return at.length === 0 ? null : Math.min(...at);
}

export const plateShown = (s: JoinSheet, now: number): boolean => s.open && s.plateUntil !== null && now < s.plateUntil;
