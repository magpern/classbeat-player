// "Confirm it is you" (docs/design/site.md, "Account"; ADR 0002, section 4; ADR 0010, section 5):
// the plate an account page shows when a change answers 403 `recent_sign_in_required`. The one way
// to confirm is a fresh sign-in at classbeat: "Confirm with classbeat" starts it and goes there.
// The email link and passkeys are closed for every account kind there is today (ADR 0010,
// section 7), so the plate offers neither. classbeat's callback lands on /classes: the change is
// not made for the person, they come back and press it again. While classbeat opens, one working
// line takes the plate's place; a start that did not work replaces it with its own plate, whose
// button still reads "Confirm with classbeat".
import { CONFIRM_WORDS } from "../core/account-model.ts";
import type { Words } from "../core/account-model.ts";
import { plateWords } from "../core/sign-in-model.ts";
import type { Plate } from "../core/sign-in-model.ts";
import { button, plate, small, working } from "../ui/kit.ts";

/** The plate's state: asking, opening classbeat, or a start that did not work. */
export type ConfirmView = { readonly kind: "ask" } | { readonly kind: "waiting" } | { readonly kind: "failed"; readonly plate: Plate };

export interface ConfirmActions {
  readonly withClassbeat: () => void;
  /** The words of the asking plate; "Confirm it is you" when absent. */
  readonly ask?: Words;
  /** A second action beside "Confirm with classbeat" (a link), on the asking and the failed plate. */
  readonly also?: () => Node;
}

/** The plate, or the one working line while classbeat is being opened. */
export function confirmNodes(view: ConfirmView, act: ConfirmActions): Node[] {
  if (view.kind === "waiting") {
    const line = working(CONFIRM_WORDS.waiting);
    line.dataset.confirm = "waiting";
    line.tabIndex = -1;
    return [line, small(CONFIRM_WORDS.waitingDetail)];
  }
  const words = view.kind === "failed" ? plateWords(view.plate) : (act.ask ?? CONFIRM_WORDS);
  const go = button(CONFIRM_WORDS.classbeat, { onPress: act.withClassbeat });
  const box = plate(words.head, words.detail, go, act.also ? act.also() : null);
  box.dataset.confirm = view.kind;
  return [box];
}
