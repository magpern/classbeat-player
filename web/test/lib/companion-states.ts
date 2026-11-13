// Recorded `companion_state` messages (the contract's valid examples) as the page's checked
// states, and a session fed with them, for the companion's unit tests.
import { startLive, step } from "../../src/companion/core/session.ts";
import type { Event, Live } from "../../src/companion/core/session.ts";
import type { CompanionState } from "../../src/companion/core/state-check.ts";
import { parseInbound } from "../../src/companion/core/wire.ts";
import type { Inbound } from "../../src/companion/core/wire.ts";
import { examples } from "./live-examples.ts";

type Name = "following-locked" | "manual-paused-last-interval" | "not-started" | "resync-announced";

export function recorded(name: Name): CompanionState {
  const ex = examples("companion-state", "valid").find((e) => e.name.endsWith(`/${name}.json`));
  const m = ex && parseInbound(ex.text);
  if (!m || m.type !== "companion_state") throw new Error(`no recorded state ${name}`);
  return m.state;
}

/** A state changed from a recorded one, checked again so it stays on the contract. */
export function variant(base: CompanionState, change: Record<string, unknown>): CompanionState {
  const m = parseInbound(JSON.stringify({ ...base, ...change }));
  if (!m || m.type !== "companion_state") throw new Error(`variant off the contract: ${JSON.stringify(change)}`);
  return m.state;
}

export const msg = (m: Inbound, at: number): Event => ({ type: "message", msg: m, at });
export const stateMsg = (state: CompanionState, at: number): Event => msg({ type: "companion_state", state }, at);

/** Welcomed with the computer in, and `state` arrived at `at`. */
export function connected(state: CompanionState, at = 1000): Live {
  let l = startLive();
  l = step(l, { type: "connecting", at: 0 });
  l = step(l, { type: "opened", at: 10 });
  l = step(l, msg({ type: "welcome", slot: 1, hostConnected: true }, 20));
  return step(l, stateMsg(state, at));
}
