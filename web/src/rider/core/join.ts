// The join form (docs/design/rider.md, "Getting in" and "Before and while joining"): what it holds,
// what Join sends, and what each answer of `POST /api/live/join` shows. Pure: no DOM, no I/O.
//
// The join body is exactly `session` and `nickname` (join-request.schema.json): the rider's FTP and
// maximum heart rate are checked here but never put in it (ADR 0007 section 1). They stay in the
// page's memory, and in localStorage only while "Remember on this phone" is on.
import type { JoinRequest } from "../../../../schema/generated/ts/live-join-request.d.ts";
import { ERROR_NAMES } from "../../companion/core/answer.ts";
import type { ErrorName } from "../../companion/core/answer.ts";
import { normaliseCode } from "../../companion/core/codes.ts";
import { closed, isObj, oneOf } from "../../companion/core/shape.ts";
import type { MyNumbers } from "./effort-calc.ts";
import { FIELD_WORDS, checkFtp, checkHrmax, checkNickname } from "./fields.ts";
import { isRiderToken } from "./wire.ts";

export type FieldName = "code" | "nickname" | "ftp" | "hrmax";
export type Plate = "away" | "too_many" | "went_wrong";

export const PLATE_WORDS: Readonly<Record<Plate, readonly [head: string, detail: string]>> = {
  away: ["You were away too long", "Join again to get back in."],
  too_many: ["Too many tries.", "Wait a minute and try again."],
  went_wrong: ["Something went wrong.", "Try again."],
};

export interface Form {
  /** The class code from the address, in its shown form; null: the rider types it. */
  readonly code: string | null;
  readonly typed: Readonly<Record<FieldName, string>>;
  readonly errors: Readonly<Partial<Record<FieldName, string>>>;
  /** "Remember on this phone": off by default. */
  readonly remember: boolean;
  /** Something is in localStorage now: Forget is shown. */
  readonly remembered: boolean;
  /** localStorage can be used on this phone. */
  readonly storage: boolean;
  readonly plate: Plate | null;
  /** The join request or `hello` is out. */
  readonly busy: boolean;
}

export function initialForm(code: string | null, storage: boolean, remembered: MyNumbers | null): Form {
  const n = (v: number | null | undefined): string => (v === null || v === undefined ? "" : String(v));
  return {
    code,
    typed: { code: "", nickname: "", ftp: n(remembered?.ftp), hrmax: n(remembered?.hrmax) },
    errors: {},
    remember: remembered !== null,
    remembered: remembered !== null,
    storage,
    plate: null,
    busy: false,
  };
}

/** Typing takes the field's own error away; the others stay. */
export function typed(f: Form, field: FieldName, text: string): Form {
  const errors = { ...f.errors };
  delete errors[field];
  return { ...f, typed: { ...f.typed, [field]: text }, errors };
}

/** The two numbers as checked: the values, or the errors of the fields that are wrong. */
export function checkNumbers(f: Form): { numbers: MyNumbers } | { errors: Partial<Record<FieldName, string>> } {
  const ftp = checkFtp(f.typed.ftp);
  const hrmax = checkHrmax(f.typed.hrmax);
  if (ftp === "bad" || hrmax === "bad") return { errors: { ...(ftp === "bad" ? { ftp: FIELD_WORDS.ftp } : {}), ...(hrmax === "bad" ? { hrmax: FIELD_WORDS.hrmax } : {}) } };
  return { numbers: { ftp, hrmax } };
}

export type Submit =
  | { readonly form: Form }
  | { readonly form: Form; readonly send: JoinRequest; readonly numbers: MyNumbers };

/** A press of "Join the class". Every field is checked first; nothing goes out unless all are good. */
export function submit(f: Form): Submit {
  if (f.busy) return { form: f };
  // The code from the address is normalised when it is read; checked again, so only the shown form goes out.
  const session = normaliseCode(f.code ?? f.typed.code);
  const nickname = checkNickname(f.typed.nickname);
  const nums = checkNumbers(f);
  const errors: Partial<Record<FieldName, string>> = {
    ...(session === null ? { code: FIELD_WORDS.code } : {}),
    ...(nickname === null ? { nickname: FIELD_WORDS.nickname } : {}),
    ...("errors" in nums ? nums.errors : {}),
  };
  if (session === null || nickname === null || "errors" in nums) return { form: { ...f, errors } };
  // Exactly the contract's two fields; the numbers go back to the page's memory only.
  const send: JoinRequest = { session, nickname };
  return { form: { ...f, code: session, typed: { ...f.typed, code: "" }, errors: {}, plate: null, busy: true }, send, numbers: nums.numbers };
}

/** How the join request went, as far as the page needs to know. */
export type Outcome =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "refused"; readonly error: ErrorName }
  | { readonly kind: "unreachable" }
  | { readonly kind: "unexpected" };

export type HttpAnswer = { readonly kind: "answer"; readonly status: number; readonly body: unknown } | { readonly kind: "unreachable" };

/** The outcome of an answer. A token is taken only from a 200 whose body is exactly the contract's. */
export function outcomeOf(a: HttpAnswer): Outcome {
  if (a.kind === "unreachable") return { kind: "unreachable" };
  const b = a.body;
  if (a.status === 200) return isObj(b) && closed(b, ["riderToken"]) && isRiderToken(b.riderToken) ? { kind: "token", token: b.riderToken } : { kind: "unexpected" };
  if (a.status === 429) return { kind: "refused", error: "too_many_requests" };
  if (isObj(b) && closed(b, ["error"]) && oneOf(b.error, ERROR_NAMES)) return { kind: "refused", error: b.error };
  return a.status === 413 ? { kind: "refused", error: "body_too_large" } : { kind: "unexpected" };
}

/** Where the page goes after an answer: into the class, the form again, or a page of its own. */
export type Next = "connect" | "form" | "not_joined" | "no_connection";

export function answered(f: Form, o: Outcome): { form: Form; next: Next } {
  if (o.kind === "token") return { form: f, next: "connect" };
  const idle = { ...f, busy: false };
  if (o.kind === "unreachable") return { form: idle, next: "no_connection" };
  // One text for every cause of cannot_join: the page never says why (ADR 0007 sections 3 and 5).
  if (o.kind === "refused" && o.error === "cannot_join") return { form: idle, next: "not_joined" };
  if (o.kind === "refused" && o.error === "too_many_requests") return { form: { ...idle, plate: "too_many" }, next: "form" };
  return { form: { ...idle, plate: "went_wrong" }, next: "form" };
}

/** Back to the form after the token lapsed: what was typed in this tab is kept, in memory only. */
export const awayForm = (f: Form): Form => ({ ...f, busy: false, errors: {}, plate: "away" });
