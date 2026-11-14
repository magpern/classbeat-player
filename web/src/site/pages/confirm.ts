// "Confirm it is you" (docs/design/site.md, "Account"; ADR 0002, section 4): the plate an account
// page shows when a change answers 403 `recent_sign_in_required`. "Use a passkey" signs in again
// here, by the browser's prompt; "Email me a link" goes to Sign in, which comes back to this page.
// Either way the change is not made for the person: they press it again.
import { CONFIRM_WORDS } from "../core/account-model.ts";
import { afterPasskey, plateWords } from "../core/sign-in-model.ts";
import type { Plate } from "../core/sign-in-model.ts";
import { passkeySignIn, passkeySupported } from "../net/passkey.ts";
import { button, note, plate, working } from "../ui/kit.ts";

/** The plate's state: asking, waiting for the prompt, or a passkey that could not be used. */
export type ConfirmView = { readonly kind: "ask" } | { readonly kind: "waiting" } | { readonly kind: "failed"; readonly plate: Plate };

export interface ConfirmActions {
  readonly usePasskey: () => void;
  readonly emailLink: () => void;
}

/** The plate, and the working line while the prompt is open. A browser without passkeys is offered the link only. */
export function confirmNodes(view: ConfirmView, act: ConfirmActions): Node[] {
  const waiting = view.kind === "waiting";
  const words = view.kind === "failed" ? plateWords(view.plate) : CONFIRM_WORDS;
  const passkey = passkeySupported() && button(waiting ? CONFIRM_WORDS.waiting : CONFIRM_WORDS.passkey, { quiet: true, disabled: waiting, onPress: act.usePasskey });
  const link = button(CONFIRM_WORDS.link, { disabled: waiting, onPress: act.emailLink });
  const box = plate(words.head, words.detail, passkey, link);
  box.dataset.confirm = view.kind;
  return waiting ? [box, working(CONFIRM_WORDS.waitingLine)] : [box];
}

/** Signs in again by passkey: "confirmed", or the sign-in plate for what stopped it. */
export async function confirmByPasskey(): Promise<"confirmed" | Plate> {
  const next = afterPasskey("", await passkeySignIn());
  if (next.screen === "signed-in") return "confirmed";
  return next.screen === "form" && next.plate ? next.plate : { kind: "server" };
}

/** The note after signing in again: nothing was changed yet. */
export const confirmedNote = (): HTMLDivElement => note(CONFIRM_WORDS.done, CONFIRM_WORDS.doneDetail);
