// "Confirm it is you" (docs/design/site.md, "Account"; ADR 0002, section 4; ADR 0010, section 5):
// the plate an account page shows when a change answers 403 `recent_sign_in_required`. The one way
// to confirm is a fresh sign-in at classbeat: "Confirm with classbeat" starts it and goes there.
// The email link and passkeys are closed for every account kind there is today (ADR 0010,
// section 7), so the plate offers neither. classbeat's callback lands on /classes: the change is
// not made for the person, they come back and press it again.
import { CONFIRM_WORDS } from "../core/account-model.ts";
import { plateWords } from "../core/sign-in-model.ts";
import type { Plate } from "../core/sign-in-model.ts";
import { button, plate, working } from "../ui/kit.ts";

/** The plate's state: asking, opening classbeat, or a start that did not work. */
export type ConfirmView = { readonly kind: "ask" } | { readonly kind: "waiting" } | { readonly kind: "failed"; readonly plate: Plate };

export interface ConfirmActions {
  readonly withClassbeat: () => void;
}

/** The plate, and the working line while classbeat is being opened. */
export function confirmNodes(view: ConfirmView, act: ConfirmActions): Node[] {
  const waiting = view.kind === "waiting";
  const words = view.kind === "failed" ? plateWords(view.plate) : CONFIRM_WORDS;
  const go = button(waiting ? CONFIRM_WORDS.waiting : CONFIRM_WORDS.classbeat, { disabled: waiting, onPress: act.withClassbeat });
  const box = plate(words.head, words.detail, go);
  box.dataset.confirm = view.kind;
  return waiting ? [box, working(CONFIRM_WORDS.waitingLine)] : [box];
}
