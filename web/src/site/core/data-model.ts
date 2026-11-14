// Account: Your data (docs/design/site.md, "Your data"; ADR 0002, sections 10 and 11): what the
// answers to the export and the deletion mean, and the words of the page. Pure: no I/O. The page
// cannot compare the typed address itself (no route returns it): the server decides.
import { plateOf } from "./account-model.ts";
import type { AccountPlate } from "./account-model.ts";
import type { Answer } from "./answer.ts";

/** The name the export is saved under (the backend's `Content-Disposition`). */
export const EXPORT_FILE = "class-player-export.json";
/** The longest address the backend compares (account_policy.CONFIRM_MAX). */
export const CONFIRM_MAX = 254;

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
