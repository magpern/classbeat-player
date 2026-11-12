// What every follower that asks a helper shares (ADR 0001: "One interface, one module per
// follower"): when it runs, which reading it holds, and when a command may go. Pure: no I/O and
// no clock of its own. A follower keeps only its helper (the process it asks) and its parsing,
// and tells this module what the helper answered.
//
// - It runs only while the instructor follows the music (`setActive`). Stopping forgets the
//   reading, closes the gate and drops every command.
// - An answer that cannot be used (garbage, a failed call, a time that cannot be told) changes
//   nothing: the last good reading stays and ages (rule 8), and the gate stays as it is.
// - A status seen between two songs is held for one poll: the reading stays as it was, and is
//   taken as it stands only when the next answer says the same.
// - Commands: nothing goes before the music app's first good answer since following began (the
//   gate). At most one is in flight and one waits, the newest replacing the one that waits (the
//   instructor's latest intent wins). A command that waits for the gate is given up when the
//   answer it waits for is unusable or never comes, so it never goes late.
// - A helper that fails to start again and again cannot work on this computer: the follower
//   stops for good and says so (`unavailable`).
import { createCallSlot } from "./call-slot.ts";
import { isTransportAction } from "./transport.ts";
import type { TransportAction } from "./transport.ts";
import type { Observation } from "./types.ts";

/** One good answer. `between` marks a status the music app passes through between two songs. */
export type Answer =
  | { readonly kind: "reading"; readonly obs: Observation; readonly between?: boolean }
  /** The music app answers and has nothing to follow. */
  | { readonly kind: "closed"; readonly between?: boolean };

/** The follower's own part: the process it asks. None of these may throw. */
export interface ReaderHelper {
  /** Start asking (a timer, or a long-lived helper). */
  start(): void;
  /** Stop asking; answers still on their way must not arrive. */
  stop(): void;
  /** Passes one command on. `taken` is called once the helper has taken it, or failed to. */
  command(action: TransportAction, taken: () => void): void;
  /** False while no helper is there that could take a command. Absent: always there. */
  listening?(): boolean;
}

export interface LifecycleOptions {
  /** Monotonic time in ms. */
  now(): number;
  /** A command not taken after this long is no longer in flight. Infinity: only the helper says. */
  readonly giveUpMs: number;
}

export interface ReaderLifecycle {
  latest(): Observation | null;
  setActive(on: boolean): void;
  send(action: TransportAction): void;
  /** True once the helper has failed to start too often; nothing runs after that. */
  unavailable(): boolean;
  readonly active: boolean;
  /** A good answer. Returns true when it was held (a status between two songs, seen once). */
  answer(a: Answer): boolean;
  /** No usable answer. `started` is false when the helper could not even be started. */
  failed(started: boolean): void;
  /** The helper is gone: nothing backs the reading any more. `started` as for `failed`. */
  lost(started: boolean): void;
}

/** This many failures to start in a row, and following is unavailable on this computer. */
export const START_FAILURES_LIMIT = 6;

export function createReaderLifecycle(opts: LifecycleOptions, helper: ReaderHelper): ReaderLifecycle {
  let active = false;
  let unavailable = false;
  let startFailures = 0;
  let last: Observation | null = null;
  /** The previous answer was a status between two songs. */
  let between = false;
  let open = false;
  let waiting: TransportAction | null = null;
  const flight = createCallSlot(opts.now, opts.giveUpMs);

  const forget = (): void => {
    open = false;
    between = false;
    waiting = null;
    flight.clear();
  };
  const off = (): void => {
    active = false;
    helper.stop();
    last = null;
    forget();
  };
  const pass = (action: TransportAction): void => {
    waiting = null;
    const ticket = flight.begin();
    helper.command(action, () => {
      if (!ticket.end()) return;
      const next = waiting;
      if (next !== null && active) pass(next);
    });
  };
  const count = (started: boolean): void => {
    if (started) startFailures = 0;
    else if (++startFailures >= START_FAILURES_LIMIT) {
      unavailable = true;
      off();
    }
  };

  return {
    latest: () => last,
    unavailable: () => unavailable,
    get active() {
      return active;
    },
    setActive(on) {
      if (on === active || (on && unavailable)) return;
      if (!on) return off();
      active = true;
      helper.start();
    },
    send(action) {
      // The name is checked again here: only one of the three names ever reaches a helper.
      if (!isTransportAction(action) || !active || helper.listening?.() === false) return;
      if (open && !flight.busy()) pass(action);
      else waiting = action;
    },
    answer(a) {
      if (!active) return false;
      startFailures = 0;
      // Held once, and only while there is a reading to hold.
      const held = a.between === true && !between && last !== null;
      between = a.between === true;
      if (!held) last = a.kind === "reading" ? a.obs : null;
      // Held or not, the music app is there and answering: the gate opens.
      open = true;
      if (waiting !== null && !flight.busy()) pass(waiting);
      return held;
    },
    failed(started) {
      if (!active) return;
      between = false;
      if (!open) waiting = null;
      count(started);
    },
    lost(started) {
      if (!active) return;
      last = null;
      forget();
      count(started);
    },
  };
}
