// What native code answers rider mode's page (issue #633, RiderSession.kt), read strictly. Pure: no
// DOM, no I/O. Native code keeps the rider token: no answer or event here has a place for one, and
// anything not of exactly these shapes is read as nothing (an event) or as "unexpected" (a join).
import { closed, intIn, isObj } from "../../../../web/src/companion/core/shape.ts";
import type { HttpAnswer } from "../../../../web/src/rider/core/join.ts";
import { MAX_FRAME_CHARS, parseInbound } from "../../../../web/src/rider/core/wire.ts";
import type { Inbound } from "../../../../web/src/rider/core/wire.ts";

/** The join's answer: in (native code holds the token), or the server's answer as the web page reads it. */
export type JoinReply = { readonly kind: "joined" } | HttpAnswer;

/** What the page hears while joined: the link opened or closed, a rider-bound message, or the hardware Back. */
export type NativeEvent =
  | { readonly kind: "opened" }
  | { readonly kind: "closed"; readonly code: number }
  | { readonly kind: "frame"; readonly msg: Inbound }
  | { readonly kind: "back" };

/** Read as an answer with no status: core/join.ts's "unexpected", "Something went wrong." */
const UNEXPECTED: HttpAnswer = { kind: "answer", status: 0, body: null };

const errorBody = (b: unknown): boolean => b === null || (isObj(b) && closed(b, ["error"]) && typeof b.error === "string" && b.error.length <= 64);

export function parseJoinReply(x: unknown): JoinReply {
  if (!isObj(x)) return UNEXPECTED;
  if (closed(x, ["result"]) && x.result === "joined") return { kind: "joined" };
  if (closed(x, ["result"]) && x.result === "unreachable") return { kind: "unreachable" };
  if (closed(x, ["result", "status", "body"]) && x.result === "answer" && intIn(x.status, 100, 599) && errorBody(x.body)) {
    return { kind: "answer", status: x.status, body: x.body };
  }
  return UNEXPECTED;
}

export function parseEvent(x: unknown): NativeEvent | null {
  if (!isObj(x)) return null;
  if (closed(x, ["kind"]) && (x.kind === "opened" || x.kind === "back")) return { kind: x.kind };
  if (closed(x, ["kind", "code"]) && x.kind === "closed" && intIn(x.code, 1000, 4999)) return { kind: "closed", code: x.code };
  if (closed(x, ["kind", "text"]) && x.kind === "frame" && typeof x.text === "string" && x.text.length <= MAX_FRAME_CHARS) {
    const msg = parseInbound(x.text);
    return msg ? { kind: "frame", msg } : null;
  }
  return null;
}
