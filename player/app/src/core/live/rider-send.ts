// When the host's connection carries a rider_state (ADR 0007 section 8, items 5 and 8). Pure: the
// message is exactly `riderStateOf`'s, published under its policy (rider-policy.ts: at once on a
// change of status or interval, otherwise every 2 s, at most 2 a second), and only in what room
// the connection's send budget leaves (send-budget.ts: everything else goes first, under 8 a
// second in all). Its input is the class and the clock alone, so nothing of a rider is in it.
import type { RiderState } from "../../../../../schema/generated/ts/live-rider-state.d.ts";
import type { PlayerState } from "../player-state.ts";
import { snapshotOf } from "../player-state.ts";
import { newRiderPolicy, riderDue, riderPublished, riderWakeAt } from "./rider-policy.ts";
import type { RiderKey, RiderPolicy } from "./rider-policy.ts";
import { riderStateOf } from "./rider-state.ts";
import type { RiderInput } from "./rider-state.ts";
import { hasRoom, roomAt, spent } from "./send-budget.ts";
import type { SendBudget } from "./send-budget.ts";

export interface RiderSender {
  readonly policy: RiderPolicy;
  /** The next rider_state's number: its own counter, for the whole run. */
  readonly seq: number;
}

export const newRiderSender = (): RiderSender => ({ policy: newRiderPolicy(), seq: 0 });

/** A new connection: its first rider_state is due at once; the run's counter goes on. */
export const riderReconnected = (r: RiderSender): RiderSender => ({ ...r, policy: newRiderPolicy() });

/** The builder's input from the presenter's state, or null while no class is open. */
export function riderInputOf(s: PlayerState, now: number, canSend: boolean): RiderInput | null {
  const { doc, view, link } = snapshotOf(s, now, canSend);
  return doc === null || view === null || link === null ? null : { doc, view, link };
}

export interface RiderTake {
  readonly sender: RiderSender;
  readonly budget: SendBudget;
  /** The rider_state to send now, or null. */
  readonly message: RiderState | null;
  /** When to ask again, or null when there is nothing to publish. */
  readonly wakeAt: number | null;
}

export function riderTake(r: RiderSender, budget: SendBudget, input: RiderInput | null, run: string, now: number): RiderTake {
  if (input === null) return { sender: r, budget, message: null, wakeAt: null };
  const state = riderStateOf(input, run, r.seq);
  const key: RiderKey = { status: state.status, index: state.now.index };
  if (riderDue(r.policy, key, now) && hasRoom(budget, now)) {
    const sender = { policy: riderPublished(r.policy, key, now), seq: r.seq + 1 };
    return { sender, budget: spent(budget, now), message: state, wakeAt: riderWakeAt(sender.policy, key, now) };
  }
  return { sender: r, budget, message: null, wakeAt: Math.max(riderWakeAt(r.policy, key, now), roomAt(budget, now)) };
}
