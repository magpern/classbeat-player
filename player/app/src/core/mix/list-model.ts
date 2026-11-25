// The Swedebeat line, its plates, the sign-in form and the mix words on a row, as the class list
// paints them (docs/design/swedebeat.md, "Class list page"). Pure: the words of the spec from the
// `MixView` the shell sends and the one thing the page holds itself, `MixUi`.
import type { Button, Marker, Panel } from "../list/states.ts";
import { REASON_WORDS } from "./mode-policy.ts";
import type { FallbackReason } from "./mode-policy.ts";
import { noteWords } from "./form-note.ts";
import type { FormNote } from "./form-note.ts";
import { mayOfferSignIn } from "./view.ts";
import type { MixFieldView, MixView } from "./view.ts";

/** What the page holds: the form is open, the sign-out question is asked, or a call is out. */
export type MixUi = "none" | "form" | "ask" | "signing-in" | "signing-out";

export interface MixLine {
  readonly marker: Marker;
  readonly text: string;
  readonly detail: string;
  readonly button: Button | null;
}
export interface MixPlate {
  readonly headline: string;
  readonly detail: string;
  /** The detail cut to one line, for when the class filter and five whole rows need the room (#724); null when the detail is short already. */
  readonly short: string | null;
  readonly buttons: readonly Button[];
}
export interface MixForm {
  readonly heading: string;
  /** Null on the form shown again under a refusal's plate. */
  readonly text: string | null;
  readonly fields: readonly MixFieldView[];
  readonly buttons: readonly Button[];
  readonly fine: string | null;
}
export interface MixHead {
  readonly line: MixLine | null;
  readonly plate: MixPlate | null;
  /** A panel or the form takes the body. */
  readonly panel: Panel | null;
  readonly form: MixForm | null;
}
export interface RowMix {
  readonly marker: Marker;
  readonly text: string;
}

const NOTE = "Swedebeat classes play on the manual clock.";
const NONE: MixHead = { line: null, plate: null, panel: null, form: null };
const btn = (id: Button["id"], label: string, key: string | null = null, primary = false): Button => ({ id, label, key, primary });
const CONNECT = btn("mix-connect", "Connect Swedebeat");
const SUBMIT = btn("mix-submit", "Connect", "Enter", true);
const CANCEL = btn("mix-cancel", "Cancel", "Esc");
const wait = (kind: string, text: string): Panel => ({ kind, heading: "One moment", text, label: null, code: null, steps: [], note: null, buttons: [] });
const only = (h: Partial<MixHead>): MixHead => ({ ...NONE, ...h });
const line = (marker: Marker, text: string, detail: string, button: Button | null = null): MixLine => ({ marker, text, detail, button });
const plate = (headline: string, detail: string, buttons: Button[] = [], short: string | null = null): MixPlate => ({ headline, detail, short, buttons });

function formOf(v: MixView, again: boolean): MixForm {
  return again
    ? { heading: "Connect Swedebeat", text: null, fields: v.fields, buttons: [SUBMIT, CANCEL], fine: null }
    : { heading: "Connect Swedebeat", text: "Type the details you use for Swedebeat. They are used once to connect and are not kept.", fields: v.fields, buttons: [SUBMIT, CANCEL], fine: "Your password is not kept." };
}

/**
 * The Swedebeat part of the page. `listed`: the list holds a Swedebeat class. The line is shown
 * only then, or while a token is held, or while the instructor is acting on it. `note`: what the
 * open form says when it stayed open without a refusal (core/mix/form-note.ts).
 */
export function mixHeadOf(v: MixView, ui: MixUi, listed: boolean, note: FormNote | null = null): MixHead {
  if (ui === "signing-out" || v.signingOut) {
    return only({ line: line("work", "Signing out of Swedebeat", "The mixes saved on this computer are being removed"), panel: wait("mix-signing-out", "Nothing can start until this is done. You can still open a class file.") });
  }
  if (ui === "signing-in" || v.state === "signing_in") {
    return only({ line: line("work", "Connecting to Swedebeat…", "Your details were sent and have been cleared from this page"), panel: wait("mix-connecting", "Swedebeat classes can start on the manual clock meanwhile.") });
  }
  if (v.state === "signed_in") {
    if (ui === "ask") return only({ plate: plate("Sign out of Swedebeat?", `The mixes saved on this computer are removed. ${NOTE}`, [btn("mix-sign-out-yes", "Sign out"), btn("mix-keep", "Keep connected", "Esc")], "The mixes saved on this computer are removed.") });
    return only({ line: line("ok", "Swedebeat is connected", "Mixes download in the background and play from this computer", btn("mix-sign-out", "Sign out of Swedebeat")) });
  }
  if (v.state === "disabled") return listed ? only({ line: line("away", "Swedebeat playback is off", NOTE) }) : NONE;
  if (!v.keychainUsable) return listed ? only({ line: line("away", "Swedebeat cannot be connected here", `This computer has no safe place to keep the sign-in. ${NOTE}`) }) : NONE;
  const refusal = v.state === "refused" ? v.refusal : null;
  if (ui === "form" && mayOfferSignIn(v)) {
    // The page's own note is newer than a refusal the shell still holds. The form stays the one
    // already shown, so the fields filled in are not emptied by a repaint.
    if (note !== null) {
      const w = noteWords(note);
      return only({ plate: plate(w.headline, w.detail), form: formOf(v, refusal === "bad_credentials" || refusal === "rate_limited") });
    }
    if (refusal === "bad_credentials") return only({ plate: plate("Swedebeat did not accept those details", "Check them and type them again. Nothing was kept."), form: formOf(v, true) });
    if (refusal === "rate_limited") return only({ plate: plate("Too many tries", "Wait a few minutes, then type your details again. Nothing was kept."), form: formOf(v, true) });
    return only({ form: formOf(v, false) });
  }
  if (refusal === "unavailable") return only({ plate: plate("Swedebeat could not be reached", `Check the connection, then try again. ${NOTE}`, [btn("mix-connect", "Try again")], "Check the connection, then try again.") });
  if (v.needsReconnect) return only({ plate: plate("Swedebeat needs you to connect again", `The mixes saved on this computer are kept. ${NOTE}`, [btn("mix-connect", "Connect Swedebeat again")], "The mixes saved on this computer are kept.") });
  return listed ? only({ line: line("away", "Swedebeat is not connected", `${NOTE} Connect to play the mixes.`, mayOfferSignIn(v) ? CONNECT : null) }) : NONE;
}

/** Why a Swedebeat class plays on the manual clock, or null when nothing here says it does. */
export function manualReason(v: MixView): FallbackReason | null {
  if (v.state === "disabled") return "disabled";
  if (!v.keychainUsable) return "no_keychain";
  return v.state === "signed_in" ? null : "not_connected";
}

/** The mix words on a Swedebeat row: "Manual clock" while a source is on and no token is held. */
export function rowMixOf(v: MixView): RowMix | null {
  const reason = manualReason(v);
  return reason === null || reason === "disabled" ? null : { marker: "away", text: "Manual clock" };
}

/** The end of the footer's line for a Swedebeat class on the manual clock. */
export function footerReason(v: MixView): string | null {
  const reason = manualReason(v);
  return reason === null ? null : `Manual clock: ${REASON_WORDS[reason]}`;
}
