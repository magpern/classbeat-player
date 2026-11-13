// The host's side of one class run on its live connection (ADR 0005 sections 4 and 5): publishes
// companion_state, takes the phones' commands through the pure intake and applies them down the
// presenter's own path, all within the send budget. The decisions are the pure modules'
// (companion-state.ts, intake.ts, send-budget.ts); this only carries them out, with one timer.
// Nothing is buffered for a connection that is not there: a lost connection drops its queue.
// The run's `end` is its last message (`last`): once it is sent, nothing more is.
import type { ClockCommand } from "../../core/commands.ts";
import type { PlayerState } from "../../core/player-state.ts";
import type { CompanionAction } from "../../core/live/actions.ts";
import { companionStateOf } from "../../core/live/companion-state.ts";
import { parseForwardedCommand } from "../../core/live/forwarded.ts";
import { intake, newIntake, recordPublished } from "../../core/live/intake.ts";
import type { IntakeMemory } from "../../core/live/intake.ts";
import { controllerJoined, enqueue, newBudget, stateChanged, take, wakeAt } from "../../core/live/send-budget.ts";
import type { HostMessage, SendBudget } from "../../core/live/send-budget.ts";
import type { End } from "../../../../../schema/generated/ts/live-end.d.ts";
import type { Slot } from "../../core/live/host-wire.ts";

/** The class as the live session reads it and steers it: the presenter's own controller. */
export interface LiveHost {
  read(): { readonly state: PlayerState; readonly now: number; readonly canSend: boolean };
  /** Applies a command exactly as the presenter's button would (controller.command). */
  apply(cmd: ClockCommand): void;
}

export interface PublisherDeps {
  readonly run: string;
  readonly host: LiveHost;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly applied: (slot: Slot, action: CompanionAction, deltaMs: number | null) => void;
}

export interface Publisher {
  /** A connection is in (`welcome`): a fresh budget, the state at once. */
  connected(send: (text: string) => void): void;
  /** The connection is gone: its queue goes with it. */
  disconnected(): void;
  joined(): void;
  queue(message: HostMessage): void;
  /** A forwarded command, untrusted. */
  command(raw: unknown): void;
  /** The class may have changed (called with every snapshot). */
  tick(): void;
  /**
   * Queues the run's last message, within the budget; `sent` is told once it has gone, and nothing
   * is sent after it. False, with nothing queued, when no connection is in.
   */
  last(message: End, sent: () => void): boolean;
  stop(): void;
}

export function createPublisher(d: PublisherDeps): Publisher {
  let memory: IntakeMemory = newIntake(d.run);
  let budget: SendBudget | null = null;
  let send: ((text: string) => void) | null = null;
  let seq = 0;
  let lastShown = "";
  let timer: unknown = null;
  let lastSent: (() => void) | null = null;

  const cancel = (): void => {
    if (timer !== null) d.clearTimer(timer);
    timer = null;
  };
  // The state without its number: a change is anything the phone would show differently.
  const picture = (): string => {
    const r = d.host.read();
    const s = companionStateOf(r.state, r.now, r.canSend, d.run, 0);
    return s === null ? "" : JSON.stringify(s);
  };

  const pump = (): void => {
    cancel();
    const out = send;
    if (budget === null || out === null) return;
    const r = d.host.read();
    const due = take(budget, r.now);
    budget = due.budget;
    for (const s of due.sends) {
      if (s.kind === "message") {
        const isLast = s.message.type === "end" ? lastSent : null;
        out(JSON.stringify(s.message));
        if (isLast !== null) return finished(isLast);
      } else {
        const state = companionStateOf(r.state, r.now, r.canSend, d.run, seq);
        if (state === null) continue;
        out(JSON.stringify(state));
        memory = recordPublished(memory, state, r.now);
        lastShown = JSON.stringify({ ...state, seq: 0 });
        seq += 1;
      }
      // A send can end the run or replace the connection at once (a transport that answers within
      // `send`, #216, #217): then nothing more goes through this sender, not even to a new one.
      if (send !== out) return;
    }
    const wait = Math.max(0, wakeAt(budget, r.now) - r.now);
    timer = d.setTimer(pump, wait);
  };

  const stop = (): void => {
    cancel();
    send = null;
    budget = null;
    lastSent = null;
  };
  const finished = (sent: () => void): void => {
    stop();
    sent();
  };

  return {
    connected(s) {
      send = s;
      budget = newBudget();
      pump();
    },
    disconnected() {
      cancel();
      send = null;
      budget = null;
    },
    joined() {
      if (budget === null || lastSent !== null) return;
      budget = controllerJoined(budget);
      pump();
    },
    queue(message) {
      if (budget === null || lastSent !== null) return;
      budget = enqueue(budget, message);
      pump();
    },
    command(raw) {
      if (budget === null || lastSent !== null) return;
      const r = d.host.read();
      const out = intake(memory, r.state, raw, r.now, r.canSend);
      memory = out.memory;
      if (out.result === null) return;
      if (out.command !== null) {
        d.host.apply(out.command);
        const c = parseForwardedCommand(raw);
        if (c !== null) d.applied(c.slot === 2 ? 2 : 1, c.action, c.deltaMs ?? null);
      }
      budget = stateChanged(enqueue(budget, out.result));
      pump();
    },
    tick() {
      if (budget === null || lastSent !== null) return;
      if (picture() === lastShown) return;
      budget = stateChanged(budget);
      pump();
    },
    last(message, sent) {
      if (budget === null || lastSent !== null) return false;
      lastSent = sent;
      budget = enqueue(budget, message);
      pump();
      return true;
    },
    stop,
  };
}
