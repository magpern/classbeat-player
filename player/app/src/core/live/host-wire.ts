// What the host reads from the live process (schema/live/v1, ADR 0005 section 4). Pure. Every
// answer and message is checked here again, field by field, before the app acts on it: a closed
// shape, the contract's patterns and ranges. Anything else is dropped. A forwarded `command` is
// passed on untouched to the command intake (intake.ts), which checks it itself.
import type { CodeCancelled } from "../../../../../schema/generated/ts/live-code-cancelled.d.ts";
import type { Ended } from "../../../../../schema/generated/ts/live-ended.d.ts";
import type { LiveErrorBody } from "../../../../../schema/generated/ts/live-error.d.ts";
import type { HttpAnswer } from "../pairing/protocol.ts";

/** A text frame larger than this is not read (ADR 0002 caps every message well below it). */
export const MAX_FRAME_CHARS = 64 * 1024;

export const SHORT_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOST_TOKEN = /^cbp_hst_[A-Za-z0-9_-]{43}$/;
/** The longest a control code lives (ADR 0002: 2 minutes). */
export const MAX_CODE_MS = 120_000;

export interface StartedSession {
  readonly sessionId: string;
  readonly joinCode: string;
  /** Kept in the main process's memory only: never stored, logged, shown or sent but in `hello`. */
  readonly hostToken: string;
}

export type StartRefusal = "pair_again" | "sessions_full" | "too_many" | "unreachable" | "server";
export type StartAnswer = { readonly ok: true; readonly session: StartedSession } | { readonly ok: false; readonly refusal: StartRefusal };

export type Slot = 1 | 2;
export type Via = "sign_in" | "code";

export type HostInbound =
  | { readonly type: "welcome" }
  | { readonly type: "controller_joined"; readonly slot: Slot; readonly via: Via }
  | { readonly type: "controller_left"; readonly slot: Slot; readonly via: Via }
  | { readonly type: "control_code"; readonly code: string; readonly expiresInMs: number }
  | { readonly type: "code_cancelled"; readonly reason: CodeCancelled["reason"] }
  | { readonly type: "ended"; readonly reason: Ended["reason"] }
  | { readonly type: "command"; readonly raw: Record<string, unknown> };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Exactly these keys, no more and no fewer. */
const hasKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(v, k));
};

const isSlot = (v: unknown): v is Slot => v === 1 || v === 2;
const isVia = (v: unknown): v is Via => v === "sign_in" || v === "code";
const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === "string" && (values as readonly string[]).includes(v);

const CANCEL_REASONS: readonly CodeCancelled["reason"][] = ["wrong_tries", "expired", "used", "replaced"];
const ENDED_REASONS: readonly Ended["reason"][] = ["host_ended", "revoked", "expired", "dropped"];
const ERRORS: readonly LiveErrorBody["error"][] = ["invalid_request", "invalid_token", "token_unknown", "token_expired", "token_revoked", "sessions_full", "cannot_control", "invalid_code", "controllers_full", "too_many_requests", "internal_error"];

/** The answer of `POST /api/live/sessions`: the session, or why there is none. */
export function parseStartAnswer(a: HttpAnswer): StartAnswer {
  if (a.kind === "unreachable") return { ok: false, refusal: "unreachable" };
  const b = a.body;
  if (a.status === 200 && isPlainObject(b) && hasKeys(b, ["sessionId", "joinCode", "hostToken"])) {
    const { sessionId, joinCode, hostToken } = b;
    if (typeof sessionId === "string" && SESSION_ID.test(sessionId) && typeof joinCode === "string" && SHORT_CODE.test(joinCode) && typeof hostToken === "string" && HOST_TOKEN.test(hostToken)) {
      return { ok: true, session: { sessionId, joinCode, hostToken } };
    }
    return { ok: false, refusal: "server" };
  }
  const error = isPlainObject(b) && hasKeys(b, ["error"]) && oneOf(b.error, ERRORS) ? b.error : null;
  if (a.status === 401) return { ok: false, refusal: "pair_again" };
  if (a.status === 409 && error === "sessions_full") return { ok: false, refusal: "sessions_full" };
  if (a.status === 429) return { ok: false, refusal: "too_many" };
  return { ok: false, refusal: "server" };
}

/** One text frame from the live process to the host, or null when it is not a message the host takes. */
export function parseHostFrame(text: string): HostInbound | null {
  if (text.length > MAX_FRAME_CHARS) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  return parseHostMessage(v);
}

export function parseHostMessage(v: unknown): HostInbound | null {
  if (!isPlainObject(v) || v.v !== 1) return null;
  switch (v.type) {
    case "welcome":
      // The host's welcome holds its role and nothing else (no slot, no host status).
      return hasKeys(v, ["v", "type", "role"]) && v.role === "host" ? { type: "welcome" } : null;
    case "controller_joined":
    case "controller_left":
      return hasKeys(v, ["v", "type", "slot", "via"]) && isSlot(v.slot) && isVia(v.via) ? { type: v.type, slot: v.slot, via: v.via } : null;
    case "control_code": {
      if (!hasKeys(v, ["v", "type", "code", "expiresInMs"])) return null;
      const { code, expiresInMs } = v;
      const okMs = typeof expiresInMs === "number" && Number.isSafeInteger(expiresInMs) && expiresInMs >= 1 && expiresInMs <= MAX_CODE_MS;
      return typeof code === "string" && SHORT_CODE.test(code) && okMs ? { type: "control_code", code, expiresInMs } : null;
    }
    case "code_cancelled":
      return hasKeys(v, ["v", "type", "reason"]) && oneOf(v.reason, CANCEL_REASONS) ? { type: "code_cancelled", reason: v.reason } : null;
    case "ended":
      return hasKeys(v, ["v", "type", "reason"]) && oneOf(v.reason, ENDED_REASONS) ? { type: "ended", reason: v.reason } : null;
    case "command":
      return { type: "command", raw: v };
    default:
      return null;
  }
}

/** The live WebSocket's address on the backend's origin: wss for https, ws for loopback http in development. */
export function liveSocketUrl(origin: string): string {
  const url = new URL("/api/live/ws", origin);
  return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}${url.pathname}`;
}
