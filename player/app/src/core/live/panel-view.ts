// What the presenter's phone-remote panel shows (ADR 0005 sections 2, 3 and 5; companion.md,
// "For the presenter window"). Pure. Built for the presenter window only: the shell answers it on
// the presenter's own channel and never sends it to the room window. It holds the class code and,
// with a second display, the control code; never the host token, the session id or anything about
// a phone but its place. Sentence case, one fact a line (presenter.md).
import { clockText } from "../format.ts";
import type { Slot } from "./host-wire.ts";
import type { Applied, EndReason, LiveModel, Place, Refusal } from "./session-types.ts";

export interface SlotView {
  readonly slot: Slot;
  /** "Phone 1: steering", "Phone 1: not connected" or "Phone 1: free". */
  readonly text: string;
  readonly canDrop: boolean;
}

export interface LivePanelView {
  /** Whether the panel is shown: while a class is open, or while a session is still to be told about. */
  readonly shown: boolean;
  readonly status: string;
  readonly detail: string | null;
  readonly canStart: boolean;
  readonly canEnd: boolean;
  readonly canMakeCode: boolean;
  /** The class code (the join code) while the session runs. */
  readonly classCode: string | null;
  /** The control code, presenter only, with a second display only. */
  readonly controlCode: string | null;
  readonly controlCodeLeft: string | null;
  readonly codeNote: string | null;
  /** Where the phone goes: the site's control page. */
  readonly controlPage: string | null;
  readonly slots: readonly SlotView[];
  /** The last phone command applied, for a few seconds: "Phone 1: pause". */
  readonly line: string | null;
}

export interface PanelFacts {
  readonly now: number;
  readonly classOpen: boolean;
  readonly secondDisplay: boolean;
  /** The backend's origin while paired, for the control page's address. */
  readonly origin: string | null;
}

const REFUSALS: Readonly<Record<Refusal, string>> = {
  no_class: "Open a class first",
  not_paired: "Pair this computer to use a phone remote",
  pair_again: "The pairing no longer works: pair this computer again",
  sessions_full: "Three phone remotes already run on this account: end one first",
  too_many: "Too many tries. Wait a minute and try again",
  unreachable: "The server cannot be reached. The class goes on",
  server: "The server did not start the phone remote. Try again",
};

const ENDINGS: Readonly<Record<EndReason, string>> = {
  host_ended: "The class goes on",
  class_changed: "A new class needs a new phone remote",
  revoked: "This computer's pairing ended. The class goes on",
  expired: "The server ended it. The class goes on",
  lost: "The server could not be reached for 15 minutes. The class goes on",
  gone: "The server no longer has it. The class goes on",
  replaced: "Another connection took its place. The class goes on",
};

const NOTES = { used: "Control code used", expired: "Control code ran out", wrong_tries: "Control code cancelled after 5 wrong tries" } as const;

/** What a phone's applied command did, in the presenter's words. */
export function lineText(a: Applied): string {
  const what: Readonly<Record<Applied["action"], string>> = {
    start: "start",
    pause: "pause",
    resume: "resume",
    skip: "skip",
    nudge: (a.deltaMs ?? 0) < 0 ? "back 5 s" : "forward 5 s",
    undo_resync: "undo",
  };
  return `Phone ${a.slot}: ${what[a.action]}`;
}

const PLACE_TEXT: Readonly<Record<Place, string>> = { connected: "steering", away: "not connected", none: "free" };

function statusOf(m: LiveModel): string {
  switch (m.phase) {
    case "idle":
      return "Off";
    case "starting":
      return "Starting…";
    case "connecting":
      return "Connecting…";
    case "live":
      return "On";
    case "reconnecting":
      return "Reconnecting";
    case "ended":
      return "Ended";
    case "refused":
      return "Not started";
  }
}

function detailOf(m: LiveModel, f: PanelFacts): string | null {
  if (m.phase === "refused" && m.refusal !== null) return REFUSALS[m.refusal];
  if (m.phase === "ended" && m.ended !== null) return ENDINGS[m.ended];
  if (m.phase === "reconnecting") return "The class goes on. The phone remote is back when the server answers";
  if (m.phase === "live" && !f.secondDisplay) return "On the phone, sign in and type the class code. A control code needs a second display";
  if (m.phase === "live") return "On the phone, sign in and type the class code, or type both codes";
  if (m.phase === "idle") return "Steer the class from your phone on the handlebar";
  return null;
}

export function livePanelView(m: LiveModel, f: PanelFacts): LivePanelView {
  const running = m.phase === "connecting" || m.phase === "live" || m.phase === "reconnecting";
  const live = m.phase === "live";
  const code = live && f.secondDisplay && m.code !== null && f.now < m.code.expiresAt ? m.code : null;
  const slots: SlotView[] = running
    ? ([1, 2] as const).map((slot) => {
        const p = m.places[slot - 1];
        return { slot, text: `Phone ${slot}: ${PLACE_TEXT[p]}`, canDrop: live && p !== "none" };
      })
    : [];
  return {
    shown: f.classOpen || m.phase !== "idle",
    status: statusOf(m),
    detail: detailOf(m, f),
    canStart: f.classOpen && (m.phase === "idle" || m.phase === "ended" || m.phase === "refused"),
    // While starting, End cancels: the answer, when it comes, is ended on the backend (#203).
    canEnd: running || m.phase === "starting",
    canMakeCode: live && f.secondDisplay && code === null,
    classCode: running ? (m.session?.joinCode ?? null) : null,
    controlCode: code?.code ?? null,
    controlCodeLeft: code === null ? null : clockText(code.expiresAt - f.now + 999),
    codeNote: live && f.secondDisplay && code === null && m.codeNote !== null ? NOTES[m.codeNote] : null,
    controlPage: running && f.origin !== null ? `${f.origin}/control` : null,
    slots,
    line: live && m.line !== null && f.now < m.line.until ? lineText(m.line) : null,
  };
}
