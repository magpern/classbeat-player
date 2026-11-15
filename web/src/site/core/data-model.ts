// Account: Your data (docs/design/site.md, "Your data"; ADR 0002, sections 10 and 11): what the
// answers to the export and the deletion mean, and the words of the page. Pure: no I/O. The page
// knows from `GET me` only whether the account has an email, and never compares what was typed:
// the server decides.
import { plateOf } from "./account-model.ts";
import type { AccountPlate } from "./account-model.ts";
import type { Answer } from "./answer.ts";

/** The name the export is saved under (the backend's `Content-Disposition`). */
export const EXPORT_FILE = "class-player-export.json";
/** The longest address the backend compares (account_policy.CONFIRM_MAX). */
export const CONFIRM_MAX = 254;

/** What an account with no email (ADR 0010, section 8) types to delete it: the words shown in its place (the backend's account_policy.NO_EMAIL). */
export const NO_EMAIL = "your classbeat account";

/** What the deletion asks to be typed: the account's email, or for an account with none the words above. */
export type Confirmation = "email" | "words";

/**
 * Which confirmation the account needs, from the body of `GET me` (schema/site-api/v1/me.schema.json):
 * `email` is required, a string or null. Null when the body is not that answer. The address itself
 * is not kept: only whether there is one.
 */
export function confirmationOf(body: unknown): Confirmation | null {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !Object.hasOwn(body, "email")) return null;
  const email: unknown = (body as { readonly email: unknown }).email;
  if (email === null) return "words";
  return typeof email === "string" && email !== "" ? "email" : null;
}

/** What the answer to `POST account/export` came to, when no file was given. */
export type ExportOutcome = { readonly kind: "limit"; readonly retryAfter: number | null } | { readonly kind: "ended" } | { readonly kind: "plate"; readonly plate: AccountPlate };

export function exportOutcomeOf(a: Answer): ExportOutcome {
  if (a.kind === "too_many") return { kind: "limit", retryAfter: a.retryAfter };
  if (a.kind === "not_signed_in") return { kind: "ended" };
  // A success without a file is not an answer the page understands.
  return { kind: "plate", plate: a.kind === "ok" ? { kind: "server" } : plateOf(a) };
}

/** What the answer to `POST account/delete` came to. */
export type DeleteOutcome = { readonly kind: "deleted" } | { readonly kind: "mismatch" } | { readonly kind: "ended" } | { readonly kind: "plate"; readonly plate: AccountPlate };

export function deleteOutcomeOf(a: Answer): DeleteOutcome {
  if (a.kind === "ok") return a.status === 204 ? { kind: "deleted" } : { kind: "plate", plate: { kind: "server" } };
  if (a.kind === "not_signed_in") return { kind: "ended" };
  if (a.kind === "refused" && a.status === 422 && a.code === "confirmation_mismatch") return { kind: "mismatch" };
  return { kind: "plate", plate: plateOf(a) };
}

/** "Delete everything" is enabled once the field is not empty. */
export const canDelete = (typed: string): boolean => typed.trim() !== "";

/** "in about 7 hours", from `Retry-After` in seconds, rounded up; "later" without one. */
export function hoursWords(seconds: number | null): string {
  if (seconds === null) return "later";
  const hours = Math.max(1, Math.ceil(seconds / 3600));
  return hours === 1 ? "in about 1 hour" : `in about ${hours} hours`;
}

export const DATA_WORDS = {
  exportHeading: "Export your data",
  exportIntro: "Download everything held about your account as one file: classes, devices, linked apps, passkey names, sessions and the activity log.",
  download: "Download export",
  limitLine: "You can export 3 times a day. The file is made when you ask and is not kept.",
  exporting: "Making your export. Your browser saves it when it is ready.",
  started: "Your export has started",
  startedDetail: `Your browser is saving ${EXPORT_FILE}. If the file looks cut off, ask for the export again.`,
  tryAgain: "Try again",
  limitHead: "No more exports today",
  limitDetail: (retryAfter: number | null): string => `You can export 3 times a day. Try again ${hoursWords(retryAfter)}.`,
  deleteHeading: "Delete your account",
  deleteIntro: "This deletes your account and everything in it at once. Devices remove their saved classes the next time they connect. It cannot be undone.",
  deleteOpen: "Delete my account…",
  deleteAsk: "Delete your account?",
  deleteConsequence: "Everything in it is deleted at once: classes, devices, linked apps, passkeys and the activity log. Type your email address to confirm.",
  emailLabel: "Your email address",
  deleteButton: "Delete everything",
  keep: "Keep my account",
  mismatch: "That is not the email address of this account. Nothing was deleted.",
} as const;

/** The words of the deletion panel that depend on the confirmation; the rest is the same for both. */
export interface ConfirmWords {
  readonly consequence: string;
  readonly label: string;
  readonly mismatch: string;
  readonly type: "email" | "text";
}

const WITH_EMAIL: ConfirmWords = { consequence: DATA_WORDS.deleteConsequence, label: DATA_WORDS.emailLabel, mismatch: DATA_WORDS.mismatch, type: "email" };
const WITHOUT_EMAIL: ConfirmWords = {
  consequence: `Everything in it is deleted at once: classes, devices, linked apps, passkeys and the activity log. Type “${NO_EMAIL}” to confirm.`,
  label: `Type “${NO_EMAIL}”`,
  mismatch: `That is not “${NO_EMAIL}”. Nothing was deleted.`,
  type: "text",
};

export const confirmWords = (c: Confirmation): ConfirmWords => (c === "email" ? WITH_EMAIL : WITHOUT_EMAIL);
