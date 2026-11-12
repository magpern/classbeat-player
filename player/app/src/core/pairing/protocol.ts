// What the server answers to the app's four calls (ADR 0002, sections 2 and 6), read strictly.
// Pure. Anything not exactly an expected answer is "unexpected": the app never guesses.
import { pairingPageOn } from "./origin.ts";

/** What the edge hands over: a status with its JSON body, or no answer at all. */
export type HttpAnswer = { readonly kind: "http"; readonly status: number; readonly body: unknown; readonly retryAfterS: number | null } | { readonly kind: "unreachable" };

const SECRET = "[A-Za-z0-9_-]{43}";
const DEVICE_CODE = new RegExp(`^cbp_dc_${SECRET}$`);
const DEVICE_TOKEN = new RegExp(`^cbp_dev_${SECRET}$`);
const USER_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

export const isDeviceToken = (v: unknown): v is string => typeof v === "string" && DEVICE_TOKEN.test(v);

export const MIN_INTERVAL_S = 5;
const MAX_INTERVAL_S = 60;
const MAX_EXPIRES_S = 3600;
export const MAX_EMAIL = 320;
export const MAX_LABEL = 40;

const field = (body: unknown, key: string): unknown =>
  body !== null && typeof body === "object" && !Array.isArray(body) && Object.hasOwn(body, key) ? (body as Record<string, unknown>)[key] : undefined;

const wholeNumber = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** Text from the server that a person will read: no control or format characters, 1 to `max` long. */
export function shownText(v: unknown, max: number): string | null {
  if (typeof v !== "string" || v.length > 10 * max) return null;
  const kept = v.replace(/[\p{C}\u2028\u2029]/gu, "").trim();
  return kept.length >= 1 && kept.length <= max ? kept : null;
}

export type StartAnswer =
  | { readonly kind: "started"; readonly deviceCode: string; readonly userCode: string; readonly page: string; readonly expiresInMs: number; readonly intervalMs: number }
  | { readonly kind: "too_many" | "unreachable" | "unexpected" };

export function parseStartAnswer(a: HttpAnswer, origin: string): StartAnswer {
  if (a.kind === "unreachable") return { kind: "unreachable" };
  if (a.status === 429) return { kind: "too_many" };
  if (a.status >= 500) return { kind: "unreachable" };
  if (a.status !== 200) return { kind: "unexpected" };
  const deviceCode = field(a.body, "device_code");
  const userCode = field(a.body, "user_code");
  const page = pairingPageOn(origin, field(a.body, "verification_uri"));
  const expires = wholeNumber(field(a.body, "expires_in"), 1, MAX_EXPIRES_S);
  const interval = wholeNumber(field(a.body, "interval"), 1, MAX_INTERVAL_S);
  if (typeof deviceCode !== "string" || !DEVICE_CODE.test(deviceCode) || typeof userCode !== "string" || !USER_CODE.test(userCode)) return { kind: "unexpected" };
  if (page === null || expires === null || interval === null) return { kind: "unexpected" };
  // Never faster than the 5 s the protocol allows, whatever the answer says.
  return { kind: "started", deviceCode, userCode, page, expiresInMs: expires * 1000, intervalMs: Math.max(interval, MIN_INTERVAL_S) * 1000 };
}

export type PollAnswer =
  | { readonly kind: "ok"; readonly token: string; readonly email: string }
  | { readonly kind: "authorization_pending" | "slow_down" | "access_denied" | "expired_token" | "unexpected" }
  /** No answer, a server fault or a rate limit: ask again later. */
  | { readonly kind: "retry"; readonly afterMs: number | null };

const REFUSALS = ["authorization_pending", "slow_down", "access_denied", "expired_token"] as const;

export function parsePollAnswer(a: HttpAnswer): PollAnswer {
  if (a.kind === "unreachable") return { kind: "retry", afterMs: null };
  if (a.status === 429 || a.status >= 500) return { kind: "retry", afterMs: a.retryAfterS === null ? null : a.retryAfterS * 1000 };
  if (a.status === 400) {
    const code = field(a.body, "error");
    return { kind: REFUSALS.find((r) => r === code) ?? "unexpected" };
  }
  if (a.status !== 200) return { kind: "unexpected" };
  const token = field(a.body, "device_token");
  const email = shownText(field(a.body, "email"), MAX_EMAIL);
  return isDeviceToken(token) && email !== null ? { kind: "ok", token, email } : { kind: "unexpected" };
}

/** `GET /api/player/device`: the token works, is gone for good, ran out, or nothing is known. */
export type DeviceAnswer = { readonly kind: "ok"; readonly name: string } | { readonly kind: "gone" | "expired" | "unknown" };

const tokenRefusal = (a: HttpAnswer): "gone" | "expired" | null => {
  if (a.kind !== "http" || a.status !== 401) return null;
  const code = field(a.body, "error");
  if (code === "token_revoked" || code === "token_unknown") return "gone";
  return code === "token_expired" ? "expired" : null;
};

export function parseDeviceAnswer(a: HttpAnswer): DeviceAnswer {
  const refused = tokenRefusal(a);
  if (refused !== null) return { kind: refused };
  if (a.kind !== "http" || a.status !== 200) return { kind: "unknown" };
  const name = shownText(field(field(a.body, "device"), "name"), MAX_LABEL);
  return name === null ? { kind: "unknown" } : { kind: "ok", name };
}
