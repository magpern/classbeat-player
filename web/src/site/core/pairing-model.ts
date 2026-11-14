// Pairing a device as the signed-in person sees it (docs/design/site.md, "Devices and pairing";
// ADR 0002, section 6, step 3): the typed code, the name, and how each answer of
// `POST pairing/find` and `POST pairing/decide` moves the page. Pure: no I/O.
//
// The code is typed, never read from the address. The local format check is never more lenient
// than the backend's (`player_backend.code_policy.normalise_code`): what it accepts, the route
// accepts too; anything else the route's 422 decides. The page counts no tries itself: every
// refusal of a code is the route's one 404, shown as one answer.
import type { Answer } from "./answer.ts";
import { waitWords } from "./answer.ts";

/** ADR 0002, section 2: 8 letters of a 20-letter alphabet without vowels or digits. */
export const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const CODE_LENGTH = 8;
/** What a person may type, spaces and hyphens included (the backend's `INPUT_MAX`). */
export const CODE_INPUT_MAX = 40;
/** A device's name: 1 to 40 characters (the backend's `LABEL_MAX`). */
export const NAME_MAX = 40;

const TYPED = /^[A-Za-z -]*$/;
const CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/;

/**
 * The 8 letters of what was typed, or null when it is not a pairing code. Spaces, hyphens and
 * case are ignored. Only ASCII letters, spaces and hyphens are read, so the check is the
 * backend's or stricter: no character that a wider upper-casing would turn into a letter.
 */
export function codeOf(typed: string): string | null {
  if (typed.length > CODE_INPUT_MAX || !TYPED.test(typed)) return null;
  const letters = typed.replace(/[ -]/g, "").toUpperCase();
  return CODE.test(letters) ? letters : null;
}

/** The code as a person reads it: `BCDF-GHJK`. */
export const showCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

const length = (s: string): number => [...s].length;

/** The name as sent, or null when it is not 1 to 40 characters once trimmed. The backend decides the rest (422). */
export function nameOf(typed: string): string | null {
  const name = typed.trim();
  const n = length(name);
  return n >= 1 && n <= NAME_MAX ? name : null;
}

/** The name field's first value: the platform's name ("macOS computer"), within 40 characters. */
export function prefillName(platform: string): string {
  const name = `${platform.trim()} computer`;
  return length(name) <= NAME_MAX ? name : [...platform.trim()].slice(0, NAME_MAX).join("");
}

export type PairPlate =
  | { readonly kind: "not-found" }
  | { readonly kind: "too-many"; readonly retryAfter: number | null }
  | { readonly kind: "offline" }
  | { readonly kind: "server" };

/** Who asks to be paired, as `POST pairing/find` gives it. */
export interface Asker {
  readonly code: string;
  readonly platform: string;
  readonly version: string;
}

export type PairView =
  | { readonly screen: "enter"; readonly typed: string; readonly codeError?: boolean; readonly plate?: PairPlate }
  | ({ readonly screen: "found"; readonly name: string; readonly nameError?: boolean; readonly plate?: PairPlate } & Asker)
  | { readonly screen: "approved"; readonly name: string }
  | { readonly screen: "denied" }
  | { readonly screen: "limit" };

/** A view, or the session has ended (the page goes to Sign in). */
export type PairNext = PairView | { readonly screen: "ended" };

export const START: PairView = { screen: "enter", typed: "" };

const plateOf = (a: Answer): PairPlate => (a.kind === "offline" ? { kind: "offline" } : a.kind === "too_many" ? { kind: "too-many", retryAfter: a.retryAfter } : { kind: "server" });

/** "Continue" with what was typed: the field error at once for a text that is not a code, or the code to look up. */
export function continueWith(typed: string): { readonly view: PairView } | { readonly code: string } {
  const code = codeOf(typed);
  return code === null ? { view: { screen: "enter", typed, codeError: true } } : { code };
}

function askerOf(code: string, body: unknown): Asker | null {
  if (typeof body !== "object" || body === null) return null;
  const { platform, version } = body as { platform?: unknown; version?: unknown };
  return typeof platform === "string" && typeof version === "string" ? { code, platform, version } : null;
}

/** After `POST pairing/find` for `code`, typed as `typed`. */
export function afterFind(typed: string, code: string, a: Answer): PairNext {
  if (a.kind === "not_signed_in") return { screen: "ended" };
  if (a.kind === "ok") {
    const asker = askerOf(code, a.body);
    return asker ? { screen: "found", ...asker, name: prefillName(asker.platform) } : { screen: "enter", typed, plate: { kind: "server" } };
  }
  if (a.kind === "refused" && a.status === 404) return { screen: "enter", typed, plate: { kind: "not-found" } };
  if (a.kind === "refused" && a.status === 422) return { screen: "enter", typed, codeError: true };
  return { screen: "enter", typed, plate: plateOf(a) };
}

/** After `POST pairing/decide` on the "Found" view, approving with `name` or denying. */
export function afterDecide(found: Extract<PairView, { screen: "found" }>, approve: boolean, name: string, a: Answer): PairNext {
  if (a.kind === "not_signed_in") return { screen: "ended" };
  const status = a.kind === "ok" && typeof a.body === "object" && a.body !== null ? (a.body as { status?: unknown }).status : undefined;
  if (a.kind === "ok" && approve && status === "approved") return { screen: "approved", name };
  if (a.kind === "ok" && !approve && status === "denied") return { screen: "denied" };
  const again = { ...found, name, nameError: false };
  if (a.kind === "refused" && a.status === 409 && approve) return { screen: "limit" };
  // An ended or decided pairing, a wrong code and a closed form: the one answer, back at the code.
  if (a.kind === "refused" && a.status === 404) return { screen: "enter", typed: showCode(found.code), plate: { kind: "not-found" } };
  if (a.kind === "refused" && a.status === 422 && a.code === "invalid_name" && approve) return { ...again, nameError: true };
  if (a.kind === "refused" && a.status === 422 && a.code === "invalid_code") return { screen: "enter", typed: showCode(found.code), codeError: true };
  return { ...again, plate: plateOf(a) };
}

export interface Words {
  readonly head: string;
  readonly detail: string;
}

export const CODE_ERROR = "That is not a pairing code. A code has eight letters.";
export const NAME_ERROR = "A name needs 1 to 40 characters";

/** The words of a plate. The limits are those of ADR 0002, section 6. */
export function pairPlateWords(p: PairPlate): Words {
  switch (p.kind) {
    case "not-found":
      return { head: "That code was not found", detail: "Check the code on the player's screen. A code works once and runs out after 10 minutes. After five wrong codes in a row this page closes for 15 minutes." };
    case "too-many":
      return { head: "Please wait a little", detail: `You have asked for too much in a short time. Try again ${waitWords(p.retryAfter)}. Nothing was changed.` };
    case "offline":
      return { head: "You are offline", detail: "Check your connection, then try again." };
    case "server":
      return { head: "That did not work, and it was not your doing", detail: "Try again in a moment. If you were changing something, check that it happened before you repeat it." };
  }
}

export const LIMIT_WORDS: Words = { head: "You have 10 devices already", detail: "That is the most an account can have. Revoke one you no longer use, then start the pairing again in the player." };
