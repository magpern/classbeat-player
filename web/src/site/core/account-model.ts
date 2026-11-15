// What the account sub-pages share (docs/design/site.md, "Account"; ADR 0002, section 4): the
// sub-page links, what the answer to a change means, the plates and "Confirm it is you". Pure: no
// I/O. A change that needs a recent sign-in is never repeated for the person: a 403
// `recent_sign_in_required` only shows the plate, and they press the button again afterwards.
// A 403 `passkeys_closed` (ADR 0010, section 7) is its own plate: no sign-in again can open it, so
// it never asks to confirm.
import type { Answer } from "./answer.ts";
import { waitWords } from "./answer.ts";

export type AccountSub = "sessions" | "passkeys" | "links" | "data";

/** The account's four sub-pages, in the order they are shown, with their addresses. */
export const ACCOUNT_SUBS: readonly (readonly [AccountSub, string, string])[] = [
  ["sessions", "Sessions", "/account/sessions"],
  ["passkeys", "Passkeys", "/account/passkeys"],
  ["links", "Linked apps", "/account/links"],
  ["data", "Your data", "/account/data"],
];

/** A uuid as the site's lists give it: an id that goes into a route is only ever this. */
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export type AccountPlate =
  | { readonly kind: "confirm" }
  | { readonly kind: "not-added" }
  | { readonly kind: "passkeys-closed" }
  | { readonly kind: "too-many"; readonly retryAfter: number | null }
  | { readonly kind: "offline" }
  | { readonly kind: "server" };

/** What the answer to a change came to: done (with the body), already gone (404), the session ended, or a plate. */
export type Outcome = { readonly kind: "done"; readonly body: unknown } | { readonly kind: "gone" } | { readonly kind: "ended" } | { readonly kind: "plate"; readonly plate: AccountPlate };

export const isRecentRefusal = (a: Answer): boolean => a.kind === "refused" && a.status === 403 && a.code === "recent_sign_in_required";

/** Adding a passkey is closed for this account's kind (ADR 0010, section 7). */
export const isPasskeysClosed = (a: Answer): boolean => a.kind === "refused" && a.status === 403 && a.code === "passkeys_closed";

/** The plate for an answer that is not a success, a 404 or a 401. Only `recent_sign_in_required` asks to confirm. */
export function plateOf(a: Answer): AccountPlate {
  if (isRecentRefusal(a)) return { kind: "confirm" };
  if (isPasskeysClosed(a)) return { kind: "passkeys-closed" };
  if (a.kind === "too_many") return { kind: "too-many", retryAfter: a.retryAfter };
  return a.kind === "offline" ? { kind: "offline" } : { kind: "server" };
}

/** The answer to a change of one row or of the account (`DELETE sessions/{id}`, `POST sessions/end-all`, `DELETE passkeys/{id}`). */
export function outcomeOf(a: Answer): Outcome {
  if (a.kind === "ok") return { kind: "done", body: a.body };
  if (a.kind === "not_signed_in") return { kind: "ended" };
  if (a.kind === "refused" && a.status === 404) return { kind: "gone" };
  return { kind: "plate", plate: plateOf(a) };
}

export interface Words {
  readonly head: string;
  readonly detail: string;
}

export const CONFIRM_WORDS = {
  head: "Confirm it is you",
  detail: "For this change you need to have signed in within the last 10 minutes. Sign in again with classbeat, which takes you to your classes, then come back here and make the change again.",
  classbeat: "Confirm with classbeat",
  /** The one message while classbeat opens, at the head of the page, in place of the plate. */
  waiting: "Opening classbeat…",
  waitingDetail: "Nothing was changed here.",
} as const;

export function accountPlateWords(p: AccountPlate): Words {
  switch (p.kind) {
    case "confirm":
      return { head: CONFIRM_WORDS.head, detail: CONFIRM_WORDS.detail };
    case "not-added":
      return { head: "The passkey was not added", detail: "Your browser or device cancelled or refused it. Nothing was saved." };
    case "passkeys-closed":
      return { head: "Passkeys are not available for this account", detail: "You sign in with classbeat. Passkeys already listed here can still be renamed and removed." };
    case "too-many":
      return { head: "Please wait a little", detail: `You have asked for too much in a short time. Try again ${waitWords(p.retryAfter)}. Nothing was changed.` };
    case "offline":
      return { head: "You are offline", detail: "Check your connection, then try again." };
    case "server":
      return { head: "That did not work, and it was not your doing", detail: "Try again in a moment. If you were changing something, check that it happened before you repeat it." };
  }
}
