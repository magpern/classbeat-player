// What an answer of `POST /api/live/controller` or `POST /api/live/control` means for the page
// (schema/live/v1/routing.json, error.schema.json). Pure: no DOM, no I/O.
import type { LiveErrorBody } from "../../../../schema/generated/ts/live-error.d.ts";
import { closed, isObj, oneOf } from "./shape.ts";
import { isControllerToken } from "./wire.ts";

export type ErrorName = LiveErrorBody["error"];
/** Every error name of the contract's closed enum, in its order. */
export const ERROR_NAMES: readonly ErrorName[] = ["invalid_request", "body_too_large", "invalid_token", "token_unknown", "token_expired", "token_revoked", "sessions_full", "cannot_control", "invalid_code", "controllers_full", "too_many_requests", "internal_error"];

/** How the request went, as far as the page needs to know. */
export type Outcome =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "refused"; readonly error: ErrorName }
  /** No answer at all (offline, the request failed), or an answer off the contract. */
  | { readonly kind: "unreachable" }
  | { readonly kind: "unexpected" };

/** The answer as the edge read it: a status and the parsed body, or no answer. */
export type HttpAnswer = { readonly kind: "answer"; readonly status: number; readonly body: unknown } | { readonly kind: "unreachable" };

/** The outcome of an answer. A token is taken only from a 200 whose body is exactly the contract's. */
export function outcomeOf(a: HttpAnswer): Outcome {
  if (a.kind === "unreachable") return { kind: "unreachable" };
  const b = a.body;
  if (a.status === 200) {
    return isObj(b) && closed(b, ["controllerToken"]) && isControllerToken(b.controllerToken) ? { kind: "token", token: b.controllerToken } : { kind: "unexpected" };
  }
  // A 429 is too many requests whatever its body says (a proxy may answer it too).
  if (a.status === 429) return { kind: "refused", error: "too_many_requests" };
  if (isObj(b) && closed(b, ["error"]) && oneOf(b.error, ERROR_NAMES)) return { kind: "refused", error: b.error };
  return a.status === 413 ? { kind: "refused", error: "body_too_large" } : { kind: "unexpected" };
}
