// Holds the shell's state and sends snapshots to the presenter. The clock reads the monotonic
// performance.now(), so a change of the system clock never moves class time.
import { performance } from "node:perf_hooks";
import type { WebContents } from "electron";
import classSchema from "../../../../schema/class-format/v1/class.schema.json" with { type: "json" };
import { CH_UPDATE } from "../core/channels.ts";
import type { ClockCommand } from "../core/commands.ts";
import { advance, command, INITIAL, openText, refuse, snapshotOf } from "../core/player-state.ts";
import type { PlayerState } from "../core/player-state.ts";
import { manualReader } from "../core/link/reader.ts";
import type { MusicReader } from "../core/link/reader.ts";
import type { Snapshot } from "../core/snapshot.ts";

const PUSH_EVERY_MS = 100;

export interface Controller {
  snapshot(): Snapshot;
  open(fileName: string, text: string): Snapshot;
  refuse(message: string): Snapshot;
  command(cmd: ClockCommand): Snapshot;
  attach(target: () => WebContents | null): void;
  stop(): void;
}

/** The reader is the music link's source of readings; with the manual reader the clock is manual only. */
export function createController(now: () => number = () => performance.now(), reader: MusicReader = manualReader): Controller {
  let state: PlayerState = INITIAL;
  let timer: NodeJS.Timeout | null = null;
  let target: () => WebContents | null = () => null;

  // Every snapshot follows the music first, so a snapshot taken between ticks never shows a clock
  // that ran past a window's end.
  const snapshot = (): Snapshot => {
    const t = now();
    state = advance(state, t, reader.latest(t));
    return snapshotOf(state, t);
  };
  const push = (): void => {
    const wc = target();
    if (wc && !wc.isDestroyed() && !wc.isCrashed()) wc.send(CH_UPDATE, snapshot());
  };

  return {
    snapshot,
    open(fileName, text) {
      state = openText(state, fileName, text, classSchema, now(), reader.kind !== "manual");
      push();
      return snapshot();
    },
    refuse(message) {
      state = refuse(state, message);
      push();
      return snapshot();
    },
    command(cmd) {
      state = command(state, cmd, now());
      push();
      return snapshot();
    },
    attach(t) {
      target = t;
      if (timer === null) timer = setInterval(push, PUSH_EVERY_MS);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
