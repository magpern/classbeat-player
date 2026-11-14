// What the control band holds (docs/design/play.md, "Controls and keys"). Pure: from the clock's
// status and whether the End question is open. Words, never icons; the main button's word is the
// clock's state, never the press. There is no Undo, no Follow the music and no change of clock.
import type { Status } from "../../../player/app/src/core/clock/clock.ts";
import { mainWord } from "./session.ts";

/** The `data-action` of every control the page has; the page check P5 reads exactly this list. */
export type Action = "start" | "pause" | "resume" | "previous" | "next" | "end" | "end-class" | "keep-going" | "close";

export interface ButtonView {
  readonly action: Action;
  readonly word: string;
  /** The second line: where the press goes. */
  readonly sub: string | null;
}

export type BandView =
  | { readonly mode: "buttons"; readonly previous: ButtonView; readonly main: ButtonView; readonly next: ButtonView; readonly end: ButtonView }
  | { readonly mode: "ask"; readonly question: string; readonly endClass: ButtonView; readonly keepGoing: ButtonView }
  | { readonly mode: "finished"; readonly close: ButtonView };

const button = (action: Action, word: string, sub: string | null = null): ButtonView => ({ action, word, sub });

const MAIN_ACTION = { Start: "start", Pause: "pause", Resume: "resume" } as const;

export function bandView(status: Status, asking: boolean): BandView {
  if (status === "ended") return { mode: "finished", close: button("close", "Close class", "Back to the class list") };
  if (asking) return { mode: "ask", question: "End the class?", endClass: button("end-class", "End class", "Back to the class list"), keepGoing: button("keep-going", "Keep going") };
  const word = mainWord(status);
  return { mode: "buttons", previous: button("previous", "Previous", "Interval"), main: button(MAIN_ACTION[word], word), next: button("next", "Next", "Interval"), end: button("end", "End") };
}
