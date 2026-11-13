// The "get control" page (docs/design/companion.md, "Getting control"): the two ways in, what each
// sends, and what each answer shows. Pure: no DOM, no I/O.
//
// - By sign-in: signed in on the site with the account that runs the class, the class code goes
//   to `POST /api/live/controller`. Not signed in, the key opens the site's sign-in page instead.
// - By control code (a second display only): the class code and the one-time control code go to
//   `POST /api/live/control`. A QR code of `/control#<join>.<control>` sends them at once.
// The class code alone never gives control (rule 14): `#<join>` only fills the field.
import { normaliseCode } from "./codes.ts";
import type { ErrorName, Outcome } from "./answer.ts";

export type Way = "sign_in" | "code";
export type Field = "class" | "control";

export interface FieldError {
  readonly field: Field;
  readonly text: string;
}

export interface Entry {
  /** Whether the site says this browser is signed in; null until it has answered. */
  readonly signedIn: boolean | null;
  readonly classCode: string;
  readonly controlCode: string;
  readonly busy: Way | null;
  readonly error: FieldError | null;
  /** Both places are held (`controllers_full`): the "Two phones already" page. */
  readonly full: boolean;
}

export type Request =
  | { readonly route: "controller"; readonly body: { readonly session: string } }
  | { readonly route: "control"; readonly body: { readonly session: string; readonly code: string } };

export const WORDS = {
  form: "Codes are 8 letters",
  codeWrong: "That did not work. A control code works once, for 2 minutes. Ask the computer for a new one.",
  signInWrong: "This phone cannot steer that class. Check the class code and that you are signed in with the account that runs it.",
  tooMany: "Too many tries. Wait a minute and try again.",
  wentWrong: "Something went wrong. Try again.",
  unreachable: "The phone could not reach the site. Check its connection and try again.",
} as const;

/**
 * The words for every error name of the contract, on the route the page used. `invalid_code` and
 * `cannot_control` read alike whatever the cause and say nothing about whether the class exists.
 * The names only the app's own route gives (`invalid_token`, `token_*`, `sessions_full`) cannot
 * come here; should one come, it reads as something went wrong.
 */
export const ERROR_WORDS: Readonly<Record<ErrorName, string>> = {
  invalid_request: WORDS.wentWrong,
  body_too_large: WORDS.wentWrong,
  invalid_token: WORDS.wentWrong,
  token_unknown: WORDS.wentWrong,
  token_expired: WORDS.wentWrong,
  token_revoked: WORDS.wentWrong,
  sessions_full: WORDS.wentWrong,
  cannot_control: WORDS.signInWrong,
  invalid_code: WORDS.codeWrong,
  controllers_full: "Two phones already steer this class",
  too_many_requests: WORDS.tooMany,
  internal_error: WORDS.wentWrong,
};

export function initialEntry(join: string | null): Entry {
  return { signedIn: null, classCode: join ?? "", controlCode: "", busy: null, error: null, full: false };
}

export type Submit =
  | { readonly entry: Entry; readonly send: Request }
  | { readonly entry: Entry; readonly signIn: true }
  | { readonly entry: Entry };

/** A press of "Steer this class" / "Sign in to steer" (`sign_in`) or "Get control" (`code`). */
export function submit(e: Entry, way: Way): Submit {
  if (e.busy) return { entry: e };
  if (way === "sign_in" && e.signedIn !== true) return { entry: e, signIn: true };
  const session = normaliseCode(e.classCode);
  if (session === null) return { entry: { ...e, error: { field: "class", text: WORDS.form } } };
  if (way === "sign_in") return { entry: { ...e, classCode: session, busy: way, error: null }, send: { route: "controller", body: { session } } };
  const code = normaliseCode(e.controlCode);
  if (code === null) return { entry: { ...e, classCode: session, error: { field: "control", text: WORDS.form } } };
  return { entry: { ...e, classCode: session, controlCode: code, busy: way, error: null }, send: { route: "control", body: { session, code } } };
}

export type Answered = { readonly entry: Entry; readonly token?: string };

/** The answer of the request `submit` asked for. A token is kept only in memory and sessionStorage. */
export function answered(e: Entry, way: Way, o: Outcome): Answered {
  const idle = { ...e, busy: null };
  if (o.kind === "token") return { entry: { ...idle, error: null, full: false }, token: o.token };
  const field: Field = way === "code" ? "control" : "class";
  if (o.kind === "unreachable") return { entry: { ...idle, error: { field, text: WORDS.unreachable } } };
  if (o.kind === "unexpected") return { entry: { ...idle, error: { field, text: WORDS.wentWrong } } };
  if (o.error === "controllers_full") return { entry: { ...idle, error: null, full: true, controlCode: "" } };
  return { entry: { ...idle, error: { field, text: ERROR_WORDS[o.error] } } };
}

/** Typing in a field takes its error away; the other field's stays. */
export function typed(e: Entry, field: Field, text: string): Entry {
  const error = e.error?.field === field ? null : e.error;
  return field === "class" ? { ...e, classCode: text, error } : { ...e, controlCode: text, error };
}
