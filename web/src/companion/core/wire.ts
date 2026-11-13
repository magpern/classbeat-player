// What the phone reads from and sends to the live WebSocket (schema/live/v1, ADR 0005 section 4).
// Pure: no DOM, no I/O. A controller is delivered `welcome`, `host_status`, `companion_state`,
// `ack` and `ended` (routing.json); anything else, or anything off its schema, is dropped. It
// sends only `hello` (the token, once) and `command`.
import type { Ack } from "../../../../schema/generated/ts/live-ack.d.ts";
import type { Command } from "../../../../schema/generated/ts/live-command.d.ts";
import type { Ended } from "../../../../schema/generated/ts/live-ended.d.ts";
import { MAX_SAFE, closed, head, intIn, isId, isObj, oneOf } from "./shape.ts";
import { ACTIONS, checkState } from "./state-check.ts";
import type { Action, CompanionState } from "./state-check.ts";

/** A frame longer than this is not read (ADR 0002 caps every message far below it). */
export const MAX_FRAME_CHARS = 64 * 1024;
const TOKEN = /^cbp_ctl_[A-Za-z0-9_-]{43}$/;

export type AckReason = NonNullable<Ack["reason"]>;
export type EndedReason = Ended["reason"];
export const ACK_REASONS: readonly AckReason[] = ["stale", "stale_run", "invalid", "not_allowed", "would_stop_following", "host_away", "rate"];
export const ENDED_REASONS: readonly EndedReason[] = ["host_ended", "revoked", "expired", "dropped"];
const RESULTS = ["applied", "duplicate", "refused"] as const;

export type Inbound =
  | { readonly type: "welcome"; readonly slot: 1 | 2; readonly hostConnected: boolean }
  | { readonly type: "host_status"; readonly connected: boolean }
  | { readonly type: "companion_state"; readonly state: CompanionState }
  | { readonly type: "ack"; readonly id: string; readonly result: Ack["result"]; readonly reason: AckReason | null }
  | { readonly type: "ended"; readonly reason: EndedReason };

/** A controller token as the contract shapes it (`cbp_ctl_` and 43 characters). */
export const isControllerToken = (v: unknown): v is string => typeof v === "string" && TOKEN.test(v);

function welcome(v: Record<string, unknown>): Inbound | null {
  // A controller's welcome always has its slot and whether the host is in; a host's never does.
  if (!closed(v, ["v", "type", "role", "slot", "hostConnected"]) || v.role !== "controller") return null;
  if ((v.slot !== 1 && v.slot !== 2) || typeof v.hostConnected !== "boolean") return null;
  return { type: "welcome", slot: v.slot, hostConnected: v.hostConnected };
}

function ack(v: Record<string, unknown>): Inbound | null {
  if (!closed(v, ["v", "type", "id", "result", "reason"]) || !isId(v.id) || !oneOf(v.result, RESULTS)) return null;
  // `reason` is null exactly when `result` is not `refused` (schema/live/README.md, choice 8).
  if (v.result === "refused" ? !oneOf(v.reason, ACK_REASONS) : v.reason !== null) return null;
  return { type: "ack", id: v.id, result: v.result, reason: v.result === "refused" ? (v.reason as AckReason) : null };
}

/** One text frame from the server, or null when it is not a message a controller is sent. */
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
      return head(v, "welcome") ? welcome(v) : null;
    case "host_status":
      return closed(v, ["v", "type", "connected"]) && typeof v.connected === "boolean" ? { type: "host_status", connected: v.connected } : null;
    case "companion_state": {
      const state = checkState(v);
      return state ? { type: "companion_state", state } : null;
    }
    case "ack":
      return ack(v);
    case "ended":
      return closed(v, ["v", "type", "reason"]) && oneOf(v.reason, ENDED_REASONS) ? { type: "ended", reason: v.reason } : null;
    default:
      return null;
  }
}

/** The first and only message that carries the token (ADR 0002 section 8). */
export function helloText(token: string): string {
  if (!isControllerToken(token)) throw new Error("not a controller token");
  return JSON.stringify({ v: 1, type: "hello", token });
}

export interface CommandParts {
  readonly id: string;
  readonly run: string;
  readonly basis: number;
  readonly action: Action;
  /** Only with `nudge`: exactly +5000 or -5000 (`JUMP_MS`). */
  readonly deltaMs?: 5000 | -5000;
}

/** A `command` as the contract shapes it: no `slot` (the server stamps it), `deltaMs` only with a nudge. */
export function commandMessage(p: CommandParts): Command {
  // The parts come from the page itself; a part off the contract is a bug, never sent.
  if (!isId(p.id) || !isId(p.run) || !intIn(p.basis, 0, MAX_SAFE) || !oneOf(p.action, ACTIONS)) throw new Error("not a command of the contract");
  const base = { v: 1 as const, type: "command" as const, id: p.id, run: p.run, basis: p.basis };
  if (p.action === "nudge") {
    if (p.deltaMs !== 5000 && p.deltaMs !== -5000) throw new Error("a nudge is 5000 or -5000 ms");
    return { ...base, action: "nudge", deltaMs: p.deltaMs };
  }
  return { ...base, action: p.action };
}

/** 16 random bytes as base64url without padding: a new `id` for each tap. */
export function idFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error("an id is 16 bytes");
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
