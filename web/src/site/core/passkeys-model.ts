// The Passkeys page (docs/design/site.md, "Account"; ADR 0002, section 4): what `GET passkeys`
// holds, the limit, the words of a row and what the answer to adding or renaming means. Pure: no
// I/O. The site is told a passkey's id, name and dates only: never its credential or key.
import type { Answer } from "./answer.ts";
import { ID, ISO, isRecentRefusal, outcomeOf, plateOf } from "./account-model.ts";
import type { AccountPlate } from "./account-model.ts";

/** At most 10 passkeys per account (ADR 0002, section 4). */
export const PASSKEY_MAX = 10;

export interface Passkey {
  readonly id: string;
  readonly name: string;
  readonly addedAt: string;
  readonly lastUsedAt: string | null;
}

const str = (v: unknown): v is string => typeof v === "string";

/** One passkey as the routes give it (`GET passkeys`, `POST passkeys`, `PATCH passkeys/{id}`), or null. */
export function passkeyOf(x: unknown): Passkey | null {
  if (typeof x !== "object" || x === null) return null;
  const k = x as Record<string, unknown>;
  const last = k.last_used_at;
  if (!str(k.id) || !ID.test(k.id) || !str(k.name) || !str(k.created_at) || !ISO.test(k.created_at)) return null;
  if (last !== null && !(str(last) && ISO.test(last))) return null;
  return { id: k.id, name: k.name, addedAt: k.created_at, lastUsedAt: last };
}

/** The passkeys of an answer's body, in the backend's order (the oldest first), or null for a body the page does not understand. */
export function passkeysOf(body: unknown): Passkey[] | null {
  const list = typeof body === "object" && body !== null ? (body as { passkeys?: unknown }).passkeys : undefined;
  if (!Array.isArray(list)) return null;
  const out: Passkey[] = [];
  for (const x of list) {
    const k = passkeyOf(x);
    if (k === null) return null;
    out.push(k);
  }
  return out;
}

/**
 * Whether the answer of `GET passkeys` says this account may add a passkey (`can_add`, ADR 0010,
 * section 7). Only a body of exactly `passkeys` and `can_add: true` opens adding: a body that does
 * not match the schema, `can_add` missing or not a boolean, or any other field, fails closed. A
 * true here promises no addition: the backend still answers 403 `passkeys_closed` when it is closed.
 */
export function addOpenOf(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const keys = Object.keys(body).sort();
  return keys.length === 2 && keys[0] === "can_add" && keys[1] === "passkeys" && (body as { can_add?: unknown }).can_add === true;
}

export const atLimit = (n: number): boolean => n >= PASSKEY_MAX;
export const countWords = (n: number): string => `${n} of ${PASSKEY_MAX} passkeys`;

/**
 * What adding a passkey came to: the browser's prompt cancelled or refused, or the answer of the
 * step that ended it (`POST passkeys/options`, or `POST passkeys` after its one busy resend).
 */
export type AddOutcome = "cancelled" | { readonly step: "options" | "register"; readonly answer: Answer };

export type AddNext =
  | { readonly kind: "added"; readonly passkey: Passkey }
  | { readonly kind: "limit" }
  | { readonly kind: "ended" }
  | { readonly kind: "plate"; readonly plate: AccountPlate };

const tooMany = (a: Answer): boolean => a.kind === "refused" && a.status === 409 && a.code === "too_many_passkeys";

/**
 * After adding. A refused registration (cancelled, 400 `passkey_refused`, 409 `passkey_exists`, a
 * 422) saved nothing: "Not added". The account at its limit reads the list again; a 403
 * `recent_sign_in_required` asks the person to confirm it is them, and nothing is sent again by
 * itself. A 403 `passkeys_closed`, at either step, is the plate "Passkeys are not available for
 * this account" (ADR 0010, section 7), never "Confirm it is you".
 */
export function afterAdd(o: AddOutcome): AddNext {
  if (o === "cancelled") return { kind: "plate", plate: { kind: "not-added" } };
  const a = o.answer;
  if (a.kind === "not_signed_in") return { kind: "ended" };
  if (tooMany(a)) return { kind: "limit" };
  if (o.step === "register") {
    if (a.kind === "ok") {
      const passkey = passkeyOf(a.body);
      return passkey === null ? { kind: "plate", plate: { kind: "server" } } : { kind: "added", passkey };
    }
    if (a.kind === "refused" && !isRecentRefusal(a) && [400, 409, 422].includes(a.status)) return { kind: "plate", plate: { kind: "not-added" } };
  }
  return { kind: "plate", plate: a.kind === "ok" ? { kind: "server" } : plateOf(a) };
}

export type RenameNext = { readonly kind: "renamed"; readonly passkey: Passkey } | { readonly kind: "name-error" } | { readonly kind: "gone" } | { readonly kind: "ended" } | { readonly kind: "plate"; readonly plate: AccountPlate };

/** After `PATCH passkeys/{id}`: renamed, a name the server refused (422 `invalid_name`), gone (404), the session ended, or a plate. */
export function afterRename(a: Answer): RenameNext {
  if (a.kind === "refused" && a.status === 422 && a.code === "invalid_name") return { kind: "name-error" };
  const o = outcomeOf(a);
  if (o.kind !== "done") return o;
  const passkey = passkeyOf(o.body);
  return passkey === null ? { kind: "plate", plate: { kind: "server" } } : { kind: "renamed", passkey };
}

export const PASSKEY_WORDS = {
  heading: "Passkeys",
  intro: "A passkey signs you in with this device's fingerprint, face or screen lock. Accounts that run classes sign in with classbeat and cannot add one.",
  none: "You have no passkeys yet.",
  /** The reason line where "Add a passkey" would be, while adding is closed (site.md, "Not available, after a removal"). */
  closed: "Passkeys are not available for this account. You sign in with classbeat.",
  add: "Add a passkey",
  addPanel: "Add a passkey",
  nameLabel: "Name this passkey",
  nameHint: "So you can tell it apart later. One to 40 characters.",
  addButton: "Add passkey",
  waiting: "Waiting for your passkey. Follow the prompt from your browser or device.",
  added: "Passkey added",
  addedDetail: "We emailed you to say a passkey was added.",
  addedOn: (when: string): string => `Added ${when}`,
  rename: "Rename",
  renameLabel: "Name",
  renameHint: "One to 40 characters.",
  save: "Save",
  cancel: "Cancel",
  remove: "Remove",
  removeAsk: (name: string): string => `Remove “${name}”?`,
  removeConsequence: "You can no longer sign in with it.",
  keep: "Keep it",
  removeButton: "Remove passkey",
  removed: (name: string): string => `Removed “${name}”`,
  removedDetail: "You can no longer sign in with it.",
  limit: `You have ${PASSKEY_MAX} passkeys`,
  limitDetail: "That is the most allowed. Remove one to add another.",
  tryAgain: "Try again",
} as const;
