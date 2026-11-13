// The host's send budget on its live connection (ADR 0005 section 5). Pure: it says what to send
// now; the caller sends it and asks again at `wakeAt`. ADR 0002 closes a connection beyond 10
// messages a second, so the host holds itself well under that:
// - companion_state on a change, coalesced to at most 4 a second (250 ms apart), at least once a
//   second, and at once when a controller joins;
// - command_results go first, then the host's other messages, then the state;
// - fewer than 8 messages in any second, all kinds together.
// Results always go before the state, so the 1 s heartbeat holds only while the other messages
// stay at 6 or fewer a second. They do: the server lets at most 4 commands a second reach the host
// (2 per controller), and make_code, drop and end are rare. Results are never dropped to make room.
import type { CommandResult } from "../../../../../schema/generated/ts/live-command-result.d.ts";
import type { Drop } from "../../../../../schema/generated/ts/live-drop.d.ts";
import type { End } from "../../../../../schema/generated/ts/live-end.d.ts";
import type { MakeCode } from "../../../../../schema/generated/ts/live-make-code.d.ts";

export const WINDOW_MS = 1000;
/** At most this many messages in any window, all kinds together: under 8 a second. */
export const MAX_PER_WINDOW = 7;
/** At most this many states in any window. */
export const MAX_STATES_PER_WINDOW = 4;
/** A changed state waits at least this long after the last one. */
export const STATE_GAP_MS = 250;
/** A state is sent at least this often, changed or not. */
export const HEARTBEAT_MS = 1000;

export type HostMessage = CommandResult | MakeCode | Drop | End;
export type Send = { readonly kind: "message"; readonly message: HostMessage } | { readonly kind: "state" };

export interface SendBudget {
  /** What was sent within the last window, oldest first. */
  readonly sent: readonly { readonly at: number; readonly state: boolean }[];
  readonly lastStateAt: number | null;
  readonly changed: boolean;
  readonly joined: boolean;
  readonly queue: readonly HostMessage[];
}

/** A fresh budget: the first state is due at once (on `welcome`). */
export const newBudget = (): SendBudget => ({ sent: [], lastStateAt: null, changed: true, joined: false, queue: [] });

export const stateChanged = (b: SendBudget): SendBudget => ({ ...b, changed: true });
export const controllerJoined = (b: SendBudget): SendBudget => ({ ...b, joined: true });

/** Queues a message; command_results go ahead of everything else already queued but older results. */
export function enqueue(b: SendBudget, message: HostMessage): SendBudget {
  if (message.type !== "command_result") return { ...b, queue: [...b.queue, message] };
  const i = b.queue.findIndex((m) => m.type !== "command_result");
  const at = i < 0 ? b.queue.length : i;
  return { ...b, queue: [...b.queue.slice(0, at), message, ...b.queue.slice(at)] };
}

const inWindow = (b: SendBudget, now: number) => b.sent.filter((e) => e.at > now - WINDOW_MS);

/** The earliest time at which `count` entries of `list` leave room under `cap`. */
function freeAt(list: readonly { readonly at: number }[], cap: number, now: number): number {
  return list.length < cap ? now : list[list.length - cap].at + WINDOW_MS;
}

function stateDueAt(b: SendBudget, now: number): number {
  if (b.lastStateAt === null || b.joined) return now;
  return Math.max(now, b.lastStateAt + (b.changed ? STATE_GAP_MS : HEARTBEAT_MS));
}

/** What to send now, in order, and the budget after it. */
export function take(b: SendBudget, now: number): { readonly budget: SendBudget; readonly sends: readonly Send[] } {
  let sent = inWindow(b, now);
  const queue = [...b.queue];
  const sends: Send[] = [];
  while (queue.length > 0 && sent.length < MAX_PER_WINDOW) {
    sends.push({ kind: "message", message: queue.shift() as HostMessage });
    sent = [...sent, { at: now, state: false }];
  }
  let { lastStateAt, changed, joined } = b;
  const states = sent.filter((e) => e.state).length;
  if (stateDueAt(b, now) <= now && sent.length < MAX_PER_WINDOW && states < MAX_STATES_PER_WINDOW) {
    sends.push({ kind: "state" });
    sent = [...sent, { at: now, state: true }];
    lastStateAt = now;
    changed = false;
    joined = false;
  }
  return { budget: { sent, lastStateAt, changed, joined, queue }, sends };
}

/** When `take` will next have something to send (`now` or later). */
export function wakeAt(b: SendBudget, now: number): number {
  const sent = inWindow(b, now);
  const total = freeAt(sent, MAX_PER_WINDOW, now);
  if (b.queue.length > 0) return total;
  const states = freeAt(
    sent.filter((e) => e.state),
    MAX_STATES_PER_WINDOW,
    now,
  );
  return Math.max(stateDueAt(b, now), total, states);
}
