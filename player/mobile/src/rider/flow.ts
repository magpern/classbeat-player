// Rider mode's page as a state (docs/design/app-rider-join.md, issue #633): step 1 (the code), step 2
// (the rider page's join form), the refused pages, the class and "Leave the class?". Pure: no DOM,
// no I/O. The join form and the class view are the rider page's own (web/src/rider/core); this adds
// the app's step 1 and its endings.
//
// Each of the four endings (leave, the class ended, the rider dropped, and a mode switch, which
// replaces the page) opens step 1 with nothing of the last rider: no code, no nickname, no numbers
// and Remember Off. The edge deletes the remembered numbers on every ending (app.ts).
import { normaliseCode } from "../../../../web/src/companion/core/codes.ts";
import { NO_NUMBERS } from "../../../../web/src/rider/core/effort-calc.ts";
import type { MyNumbers } from "../../../../web/src/rider/core/effort-calc.ts";
import { PLATE_WORDS, answered, initialForm, outcomeOf, submit } from "../../../../web/src/rider/core/join.ts";
import type { Form } from "../../../../web/src/rider/core/join.ts";
import type { JoinRequest } from "../../../../schema/generated/ts/live-join-request.d.ts";
import { startLive, step } from "../../../../web/src/rider/core/session.ts";
import type { Gone, Live } from "../../../../web/src/rider/core/session.ts";
import type { JoinReply, NativeEvent } from "./native.ts";

export type Screen = "code" | "details" | "not_joined" | "no_connection" | "live" | "leave";

/** How the last class ended for this page: "left" is the rider's own Leave. */
export type Ending = "left" | Gone;

export const CODE_ERROR = "Codes are 8 letters.";

/** The plate step 1 shows after an ending; Leave shows none. */
export const ENDING_WORDS: Readonly<Record<Ending, readonly [head: string, detail: string] | null>> = {
  left: null,
  removed: ["The instructor removed you from this class", "To join again, type the class code again."],
  ended: ["The class has ended", ""],
  lapsed: PLATE_WORDS.away,
};

export interface Flow {
  readonly screen: Screen;
  readonly form: Form;
  /** The rider's numbers in this page's memory (and remembered only with Remember on). */
  readonly mine: MyNumbers;
  readonly nickname: string | null;
  readonly live: Live | null;
  readonly ending: Ending | null;
}

/** The page as it opens: step 1, and the remembered numbers ready for step 2 (never a nickname). */
export function start(storage: boolean, remembered: MyNumbers | null): Flow {
  return { screen: "code", form: initialForm(null, storage, remembered), mine: remembered ?? NO_NUMBERS, nickname: null, live: null, ending: null };
}

/** "Continue": the code's shape only; nothing is sent. */
export function continueCode(f: Flow): Flow {
  const code = normaliseCode(f.form.typed.code);
  if (code === null) return { ...f, form: { ...f.form, errors: { code: CODE_ERROR } } };
  return { ...f, screen: "details", ending: null, form: { ...f.form, code, typed: { ...f.form.typed, code }, errors: {}, plate: null } };
}

/** "Back" on step 2: step 1 with the code kept. */
export function backToCode(f: Flow): Flow {
  if (f.form.busy) return f;
  return { ...f, screen: "code", form: { ...f.form, code: null, typed: { ...f.form.typed, code: f.form.code ?? f.form.typed.code }, errors: {}, plate: null } };
}

/** "Join the class": what goes to native code (the code and the nickname only), if every field is good. */
export function joinPressed(f: Flow): { flow: Flow; send?: JoinRequest } {
  const r = submit(f.form);
  if (!("send" in r)) return { flow: { ...f, form: r.form } };
  return { flow: { ...f, form: r.form, mine: r.numbers, nickname: r.send.nickname }, send: r.send };
}

/** The join's answer: into the class, the form again with a plate, or a refused page. */
export function joinAnswered(f: Flow, reply: JoinReply): Flow {
  if (!f.form.busy || f.screen !== "details") return f;
  if (reply.kind === "joined") return { ...f, screen: "live", live: startLive() };
  const a = answered(f.form, outcomeOf(reply));
  const screen: Screen = a.next === "not_joined" || a.next === "no_connection" ? a.next : "details";
  return { ...f, screen, form: a.form };
}

/** "Try again" on a refused page: step 2 as it was. */
export const retry = (f: Flow): Flow => (f.screen === "not_joined" || f.screen === "no_connection" ? { ...f, screen: "details" } : f);

/** An event from native code. A class that is over for this rider ends here. */
export function onEvent(f: Flow, e: NativeEvent, at: number): Flow {
  if (!f.live) return f;
  if (e.kind === "back") return f.screen === "live" ? { ...f, screen: "leave" } : f;
  const live = step(
    f.live,
    e.kind === "frame" ? { type: "message", msg: e.msg, at } : e.kind === "opened" ? { type: "opened", at } : { type: "closed", code: e.code, at },
  );
  if (live.gone) return ended(f, live.gone);
  const form = live.welcomed && f.form.busy ? { ...f.form, busy: false } : f.form;
  return { ...f, live, form };
}

/** "Keep riding": back to the class as it is. */
export const keepRiding = (f: Flow): Flow => (f.screen === "leave" ? { ...f, screen: "live" } : f);

/** An ending: step 1 with nothing of this rider kept (the edge also deletes the remembered numbers). */
export function ended(f: Flow, how: Ending): Flow {
  return { ...start(f.form.storage, null), ending: how };
}
