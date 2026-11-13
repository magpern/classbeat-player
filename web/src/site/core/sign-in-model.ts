// The sign-in page's states (docs/design/site.md, "Sign in") and how an answer moves between
// them. Pure: no I/O. Whether an address may sign in plays no part: every 200 from asking for a
// link is the same "Check your mail" (ADR 0002, section 4), and nothing here reads the body.
import type { Answer } from "./answer.ts";
import { waitWords } from "./answer.ts";

export type Notice = "ended" | "signed-out" | "deleted";
export const NOTICES: readonly Notice[] = ["ended", "signed-out", "deleted"];

export type Plate =
  | { readonly kind: "link-limited"; readonly retryAfter: number | null }
  | { readonly kind: "passkey-limited"; readonly retryAfter: number | null }
  | { readonly kind: "passkey-wait"; readonly retryAfter: number | null }
  | { readonly kind: "too-many"; readonly retryAfter: number | null }
  | { readonly kind: "passkey-failed" }
  | { readonly kind: "link-refused" }
  | { readonly kind: "offline" }
  | { readonly kind: "server" };

export type SignInView =
  | { readonly screen: "form"; readonly email: string; readonly notice?: Notice; readonly plate?: Plate; readonly emailError?: boolean; readonly busy?: "passkey" }
  | { readonly screen: "sent"; readonly email: string }
  | { readonly screen: "link"; readonly busy: boolean; readonly plate?: Plate };

export type Next = SignInView | { readonly screen: "signed-in" };

const failed = (a: Answer): Plate | null => {
  if (a.kind === "offline") return { kind: "offline" };
  if (a.kind === "too_many") return { kind: "too-many", retryAfter: a.retryAfter };
  return a.kind === "server" || a.kind === "not_signed_in" ? { kind: "server" } : null;
};

/** After `POST sign-in/link`. The same page for every address that the route accepts. */
export function afterLinkAsked(email: string, a: Answer): Next {
  if (a.kind === "ok") return { screen: "sent", email };
  if (a.kind === "too_many") return { screen: "form", email, plate: { kind: "link-limited", retryAfter: a.retryAfter } };
  if (a.kind === "refused" && a.status === 422) return { screen: "form", email, emailError: true };
  return { screen: "form", email, plate: failed(a) ?? { kind: "server" } };
}

/** After `POST sign-in/complete`. One answer for every refused link. */
export function afterLinkUsed(a: Answer): Next {
  if (a.kind === "ok") return { screen: "signed-in" };
  if (a.kind === "refused" || a.kind === "not_signed_in") return { screen: "form", email: "", plate: { kind: "link-refused" } };
  return { screen: "link", busy: false, plate: failed(a) ?? { kind: "server" } };
}

/** What a passkey sign-in came to: the prompt cancelled, or the answer of the step that ended it. */
export type PasskeyOutcome = "cancelled" | { readonly step: "options" | "assertion"; readonly answer: Answer };

/**
 * The backend's `Retry-After` for an attempt that found another one from the same address still
 * being checked (`passkey_policy.BUSY_RETRY_SECONDS`). A longer wait on `POST sign-in/passkey`
 * is the failed sign-ins' limit.
 */
export const BUSY_RETRY_SECONDS = 1;

/**
 * The wait before the one resend of a signed passkey answer, in seconds, or null for none (ADR
 * 0002, section 10). Only a `busy` 429 of `POST sign-in/passkey` is resent: its `Retry-After` is
 * at most `BUSY_RETRY_SECONDS`. A longer wait, or none, is a limit and is shown.
 */
export function busyResendAfter(a: Answer): number | null {
  return a.kind === "too_many" && a.retryAfter !== null && a.retryAfter <= BUSY_RETRY_SECONDS ? a.retryAfter : null;
}

/**
 * A passkey 429. Only the failed sign-ins' limit names failed sign-ins; the options' limit (how
 * many sign-ins are started) and a busy answer get neutral words, as does a 429 with no wait.
 */
function passkeyLimit(step: "options" | "assertion", retryAfter: number | null): Plate {
  const failedLimit = step === "assertion" && retryAfter !== null && retryAfter > BUSY_RETRY_SECONDS;
  return { kind: failedLimit ? "passkey-limited" : "passkey-wait", retryAfter };
}

/** After the passkey prompt and `POST sign-in/passkey` (or its options). */
export function afterPasskey(email: string, o: PasskeyOutcome): Next {
  if (o === "cancelled") return { screen: "form", email, plate: { kind: "passkey-failed" } };
  const a = o.answer;
  if (a.kind === "ok" && o.step === "assertion") return { screen: "signed-in" };
  if (a.kind === "too_many") return { screen: "form", email, plate: passkeyLimit(o.step, a.retryAfter) };
  if (a.kind === "refused") return { screen: "form", email, plate: { kind: "passkey-failed" } };
  return { screen: "form", email, plate: failed(a) ?? { kind: "server" } };
}

export interface Words {
  readonly head: string;
  readonly detail: string;
}

/** The words of a plate. The limits are those of ADR 0002, section 10. */
export function plateWords(p: Plate): Words {
  switch (p.kind) {
    case "link-limited":
      return { head: "Too many sign-in requests", detail: `Please try again ${waitWords(p.retryAfter)}. One network connection can ask for 10 sign-in links an hour, whatever the email address.` };
    case "passkey-limited":
      return { head: "Too many sign-in requests", detail: `Please try again ${waitWords(p.retryAfter)}. After 10 passkey sign-ins that fail within 10 minutes, this network connection has to wait.` };
    case "passkey-wait":
      return { head: "Too many sign-in requests", detail: `Please try again ${p.retryAfter !== null && p.retryAfter <= BUSY_RETRY_SECONDS ? "in a moment" : waitWords(p.retryAfter)}.` };
    case "too-many":
      return { head: "Please wait a little", detail: `You have asked for too much in a short time. Try again ${waitWords(p.retryAfter)}. Nothing was changed.` };
    case "passkey-failed":
      return { head: "That passkey could not be used", detail: "The request may have been cancelled, or the passkey may have been removed. Try again, or get a link by email." };
    case "link-refused":
      return { head: "This link cannot be used", detail: "It may have run out (a link works for 15 minutes), been used already, or been asked for in a different browser." };
    case "offline":
      return { head: "You are offline", detail: "Check your connection, then try again." };
    case "server":
      return { head: "That did not work, and it was not your doing", detail: "Try again in a moment. If you were changing something, check that it happened before you repeat it." };
  }
}

export const NOTICE_WORDS: Readonly<Record<Notice, Words>> = {
  ended: { head: "Your session ended", detail: "Sign in again to carry on where you were." },
  "signed-out": { head: "You are signed out", detail: "" },
  deleted: { head: "Your account was deleted", detail: "Everything in it is gone. Devices remove their saved classes the next time they connect." },
};
