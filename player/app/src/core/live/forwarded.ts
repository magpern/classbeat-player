// The shape check of a command the live process forwards to the host (schema/live/v1,
// command-forwarded). Pure. The server has checked it already; the player checks it again and
// drops anything that is not exactly this shape, so a relay fault can never reach the clock.
import type { ForwardedCommand } from "../../../../../schema/generated/ts/live-command-forwarded.d.ts";
import { JUMP_MS } from "../clock/clock.ts";
import { isCompanionAction } from "./actions.ts";

/** 16 random bytes, base64url without padding (the `id` and `run` of the contract). */
export const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const KEYS = ["v", "type", "slot", "id", "run", "basis", "action", "deltaMs"];
const REQUIRED = ["v", "type", "slot", "id", "run", "basis", "action"];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const isId = (v: unknown): v is string => typeof v === "string" && ID_PATTERN.test(v);

export function parseForwardedCommand(v: unknown): ForwardedCommand | null {
  if (!isPlainObject(v)) return null;
  const keys = Object.keys(v);
  if (!keys.every((k) => KEYS.includes(k)) || !REQUIRED.every((k) => Object.hasOwn(v, k))) return null;
  const { slot, id, run, basis, action } = v;
  if (v.v !== 1 || v.type !== "command") return null;
  if (slot !== 1 && slot !== 2) return null;
  if (!isId(id) || !isId(run)) return null;
  if (typeof basis !== "number" || !Number.isSafeInteger(basis) || basis < 0) return null;
  if (!isCompanionAction(action)) return null;
  const hasDelta = Object.hasOwn(v, "deltaMs");
  if (action === "nudge") {
    if (!hasDelta || (v.deltaMs !== JUMP_MS && v.deltaMs !== -JUMP_MS)) return null;
    return { v: 1, type: "command", slot, id, run, basis, action, deltaMs: v.deltaMs === JUMP_MS ? 5000 : -5000 };
  }
  if (hasDelta) return null;
  return { v: 1, type: "command", slot, id, run, basis, action };
}
