// What the rider page reads from and sends to the live WebSocket (schema/live/v1, ADR 0007
// section 2). Pure: no DOM, no I/O. Exactly four types reach a rider: `welcome` (the rider's own
// schema), `host_status`, `rider_state` and `ended`; anything else, or anything off its schema, is
// dropped. The page sends one message only: `hello`, with the rider token, once per connection.
//
// The page runs under a content security policy with no `unsafe-eval`, so no schema compiler: each
// message is checked field by field here, and test/unit/rider-wire.test.ts runs every recorded
// example of the contract through these checks.
import type { Ended } from "../../../../schema/generated/ts/live-ended.d.ts";
import type { RiderState } from "../../../../schema/generated/ts/live-rider-state.d.ts";
import { DAY_MS, MAX_SAFE, closed, head, intIn, isId, isObj, oneOf, strMax } from "../../companion/core/shape.ts";

export type { RiderState };
export type EndedReason = Ended["reason"];

/** A frame longer than this is not read (ADR 0002 caps every message far below it). */
export const MAX_FRAME_CHARS = 64 * 1024;
const TOKEN = /^cbp_rdr_[A-Za-z0-9_-]{43}$/;

export const ENDED_REASONS: readonly EndedReason[] = ["host_ended", "revoked", "expired", "dropped"];
export const STATUSES: readonly RiderState["status"][] = ["not_started", "running", "paused", "holding", "ended"];
export const POSITIONS = ["seated", "standing"] as const;
export const TEST_MINUTES = [3, 5, 20] as const;

export type Inbound =
  | { readonly type: "welcome"; readonly hostConnected: boolean }
  | { readonly type: "host_status"; readonly connected: boolean }
  | { readonly type: "rider_state"; readonly state: RiderState }
  | { readonly type: "ended"; readonly reason: EndedReason };

/** A rider token as the contract shapes it (`cbp_rdr_` and 43 characters). */
export const isRiderToken = (v: unknown): v is string => typeof v === "string" && TOKEN.test(v);

const range = (v: unknown): boolean => v === null || (Array.isArray(v) && v.length === 2 && v.every((n) => intIn(n, 0, 1000)));

function effort(v: unknown): boolean {
  return isObj(v) && closed(v, ["ftpPct", "hrmaxPct", "rpe"]) && range(v.ftpPct) && range(v.hrmaxPct) && range(v.rpe);
}

function zone(v: unknown): boolean {
  return isObj(v) && closed(v, ["number", "name", "effort"]) && intIn(v.number, 1, 7) && strMax(v.name, 80, 1) && effort(v.effort);
}

const position = (v: unknown): boolean => v === null || oneOf(v, POSITIONS);

function test(v: unknown): boolean {
  return v === null || (isObj(v) && closed(v, ["kind", "minutes"]) && v.kind === "ftp" && (TEST_MINUTES as readonly unknown[]).includes(v.minutes));
}

function now(v: unknown): boolean {
  return isObj(v) && closed(v, ["index", "zone", "position", "test", "remainingMs"]) && intIn(v.index, 0, DAY_MS - 1) && zone(v.zone) && position(v.position) && test(v.test) && intIn(v.remainingMs, 0, DAY_MS);
}

function coming(v: unknown): boolean {
  return isObj(v) && closed(v, ["startMs", "lengthMs", "zone", "position"]) && intIn(v.startMs, 0, DAY_MS) && intIn(v.lengthMs, 1, DAY_MS) && zone(v.zone) && position(v.position);
}

const KEYS = ["v", "type", "run", "seq", "status", "classMs", "lengthMs", "classRemainingMs", "now", "next"];

/** The value as a `RiderState` when it holds to rider-state.schema.json, else null. */
export function checkRiderState(v: unknown): RiderState | null {
  if (!isObj(v) || !closed(v, KEYS) || !head(v, "rider_state")) return null;
  if (!isId(v.run) || !intIn(v.seq, 0, MAX_SAFE) || !oneOf(v.status, STATUSES)) return null;
  if (!intIn(v.classMs, 0, DAY_MS) || !intIn(v.lengthMs, 1, DAY_MS) || !intIn(v.classRemainingMs, 0, DAY_MS)) return null;
  if (!now(v.now) || !Array.isArray(v.next) || v.next.length > 3 || !v.next.every(coming)) return null;
  return v as unknown as RiderState;
}

/** One text frame from the server, or null when it is not a message a rider is sent. */
export function parseInbound(text: string): Inbound | null {
  if (text.length > MAX_FRAME_CHARS) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(v) || v.v !== 1) return null;
  switch (v.type) {
    case "welcome":
      // Only a rider's welcome (welcome-rider.schema.json); a host's or a controller's is dropped.
      return closed(v, ["v", "type", "role", "hostConnected"]) && v.role === "rider" && typeof v.hostConnected === "boolean" ? { type: "welcome", hostConnected: v.hostConnected } : null;
    case "host_status":
      return closed(v, ["v", "type", "connected"]) && typeof v.connected === "boolean" ? { type: "host_status", connected: v.connected } : null;
    case "rider_state": {
      const state = checkRiderState(v);
      return state ? { type: "rider_state", state } : null;
    }
    case "ended":
      return closed(v, ["v", "type", "reason"]) && oneOf(v.reason, ENDED_REASONS) ? { type: "ended", reason: v.reason } : null;
    default:
      return null;
  }
}

/** The page's one message: `hello` with the rider token (ADR 0002 section 8). Nothing else is ever sent. */
export function helloText(token: string): string {
  if (!isRiderToken(token)) throw new Error("not a rider token");
  return JSON.stringify({ v: 1, type: "hello", token });
}
