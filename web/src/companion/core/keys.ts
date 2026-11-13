// The keys and the notice in skip's place (docs/design/companion.md, "Keys"). Pure: no DOM, no I/O.
//
// The contract's six actions and no others (rule 2: nothing here sets anything on a bike). A key is
// live when its action is in `allowed`; a greyed key says why and sends nothing. Start, Resume and
// skip are held 0.8 s to fire; Pause, the nudges and Undo are one touch.
import { isSending } from "./session.ts";
import type { Delta, Live } from "./session.ts";
import { allows } from "./state-check.ts";
import type { Action, CompanionState } from "./state-check.ts";
import { announcementWords, flashNotice } from "./words.ts";

export interface KeyModel {
  readonly action: Action;
  readonly deltaMs?: Delta;
  readonly label: string;
  /** Under the label: "Hold" on a guarded key, or why a key is greyed. */
  readonly hint: string;
  readonly hold: boolean;
  readonly main: boolean;
  readonly full: boolean;
  /** In `allowed`: a press sends the command. */
  readonly live: boolean;
  readonly sending: boolean;
}

export interface NoticeModel {
  readonly head: string;
  readonly detail: string;
  readonly undo: KeyModel | null;
}

export type KeysModel =
  | { readonly kind: "keys"; readonly keys: readonly KeyModel[]; readonly notice: NoticeModel | null }
  | { readonly kind: "msg"; readonly text: string };

export const HOLD_HINT = "Hold";
export const NOT_FOLLOWING_HINT = "Not while following";
export const LAST_INTERVAL_HINT = "Last interval";
export const NOT_NOW_HINT = "Not now";
export const SENDING = "Sending…";

/** The page's own words for why a key is greyed. */
function greyedWhy(s: CompanionState, action: Action): string {
  if (s.link.mode === "following") return NOT_FOLLOWING_HINT;
  if (action === "skip" && s.next.length === 0) return LAST_INTERVAL_HINT;
  return NOT_NOW_HINT;
}

function key(l: Live, s: CompanionState, action: Action, label: string, o: { hold?: boolean; main?: boolean; full?: boolean; deltaMs?: Delta } = {}): KeyModel {
  const live = allows(s, action);
  const sending = isSending(l, action, o.deltaMs);
  const hint = !live ? greyedWhy(s, action) : o.hold ? HOLD_HINT : "";
  return { action, ...(o.deltaMs !== undefined ? { deltaMs: o.deltaMs } : {}), label: sending ? SENDING : label, hint, hold: !!o.hold, main: !!o.main, full: !!o.full, live, sending };
}

function notice(l: Live, s: CompanionState): NoticeModel | null {
  if (l.notice) return { head: flashNotice(l.notice), detail: "", undo: null };
  const a = s.link.announcement;
  if (!a) return null;
  const canUndo = allows(s, "undo_resync");
  const words = announcementWords(a, canUndo);
  return { ...words, undo: canUndo ? key(l, s, "undo_resync", "Undo") : null };
}

export const KEYS_PHONE_AWAY = "Keys work again when the phone is back";
export const KEYS_HOST_AWAY = "Keys work again when the computer is back";
export const NOTHING_TO_STEER = "Nothing more to steer. The computer ends the session.";

/** The keys for the state on screen, or the line that stands in their place. `live`: see session.isLive. */
export function keysModel(l: Live, s: CompanionState, live: boolean): KeysModel {
  if (s.status === "ended") return { kind: "msg", text: NOTHING_TO_STEER };
  if (!live) return { kind: "msg", text: l.conn === "open" ? KEYS_HOST_AWAY : KEYS_PHONE_AWAY };
  if (s.status === "not_started") return { kind: "keys", keys: [key(l, s, "start", "Start", { hold: true, main: true, full: true })], notice: null };
  const centre = s.status === "paused" ? key(l, s, "resume", "Resume", { hold: true, main: true }) : key(l, s, "pause", "Pause", { main: true });
  const skip = key(l, s, "skip", s.link.mode === "following" ? "Next song" : "Next interval", { hold: true, full: true });
  const n = notice(l, s);
  const keys = [key(l, s, "nudge", "Back 5 s", { deltaMs: -5000 }), centre, key(l, s, "nudge", "Forward 5 s", { deltaMs: 5000 })];
  return { kind: "keys", keys: n ? keys : [...keys, skip], notice: n };
}
