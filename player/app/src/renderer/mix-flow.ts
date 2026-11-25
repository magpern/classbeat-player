// The Swedebeat actions of the class list (docs/design/swedebeat.md): the form, the sign-out
// question and the two calls to the shell. No DOM here: the page hands in its ports, so the flow
// runs under node in the tests (issue #709). The page never reads what was typed, only whether a
// field is empty; the values go straight from the fields to the shell.
import type { ListView } from "../core/list/view.ts";
import { missingNote } from "../core/mix/form-note.ts";
import type { FormNote } from "../core/mix/form-note.ts";
import type { MixUi } from "../core/mix/list-model.ts";
import type { MixFieldView } from "../core/mix/view.ts";

export interface MixFlowPorts {
  /** What the Swedebeat part of the page shows now. */
  readonly mix: () => MixUi;
  /** The fields the shell offers now. */
  readonly fields: () => readonly MixFieldView[];
  /** The ids of the fields left empty; never a value. */
  readonly emptyFields: () => ReadonlySet<string>;
  /** Every field's value, by id; every field is emptied before this returns. */
  readonly takeTyped: () => Record<string, string>;
  readonly clearTyped: () => void;
  /** Shows `mix` with `note` and paints the page. */
  readonly set: (mix: MixUi, note: FormNote | null) => void;
  readonly signIn: (typed: Record<string, string>) => Promise<ListView | null>;
  readonly signOut: () => Promise<ListView | null>;
  /** Shows the shell's answer. */
  readonly take: (v: ListView | null) => void;
  /** Reads what the shell holds again. */
  readonly refresh: () => void;
}

/** A refusal of the details or of too many tries keeps the form, empty, with the refusal plate. */
const typeAgain = (v: ListView): boolean => v.mix.state === "refused" && (v.mix.refusal === "bad_credentials" || v.mix.refusal === "rate_limited");

export function mixFlow(p: MixFlowPorts): (id: string) => void {
  return (id) => {
    if (id === "mix-connect") return p.set("form", null);
    if (id === "mix-sign-out") return p.set("ask", null);
    if (id === "mix-keep") return p.set("none", null);
    if (id === "mix-cancel") {
      p.clearTyped();
      return p.set("none", null);
    }
    if (id === "mix-submit" && p.mix() === "form") {
      // An empty field: the form stays open and says which; nothing is read or sent.
      const missing = missingNote(p.fields(), p.emptyFields());
      if (missing !== null) return p.set("form", missing);
      const typed = p.takeTyped();
      p.set("signing-in", null);
      return void p.signIn(typed).then(
        (v) => {
          // No answer from the shell keeps the form open and says the details were not sent.
          if (v === null) p.set("form", { kind: "not_taken" });
          else p.set(typeAgain(v) ? "form" : "none", null);
          p.take(v);
        },
        () => {
          // The call failed: never left on "One moment"; the form says so and the page reads again.
          p.set("form", { kind: "failed" });
          p.refresh();
        },
      );
    }
    if (id === "mix-sign-out-yes") {
      p.set("signing-out", null);
      return void p.signOut().then(
        (v) => {
          p.set("none", null);
          p.take(v);
        },
        () => {
          p.set("none", null);
          p.refresh();
        },
      );
    }
  };
}
