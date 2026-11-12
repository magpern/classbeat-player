// Holds the shell's state and sends snapshots to the presenter. The clock reads the monotonic
// performance.now(), so a change of the system clock never moves class time.
import { performance } from "node:perf_hooks";
import type { WebContents } from "electron";
import classSchema from "../../../../schema/class-format/v1/class.schema.json" with { type: "json" };
import { CH_UPDATE } from "../core/channels.ts";
import type { ClockCommand } from "../core/commands.ts";
import type { MusicAction } from "../core/music-command.ts";
import { advance, command, INITIAL, openText, refuse, snapshotOf } from "../core/player-state.ts";
import type { PlayerState } from "../core/player-state.ts";
import { manualReader } from "../core/link/reader.ts";
import type { Snapshot } from "../core/snapshot.ts";
import type { ShellReader } from "./readers/shell-reader.ts";

const PUSH_EVERY_MS = 100;

export interface Controller {
  snapshot(): Snapshot;
  open(fileName: string, text: string): Snapshot;
  refuse(message: string): Snapshot;
  command(cmd: ClockCommand): Snapshot;
  /** Play, pause or next in the music app itself; only while the instructor follows the music. */
  music(action: MusicAction): Snapshot;
  attach(target: () => WebContents | null): void;
  stop(): void;
}

/** The reader is the music link's source of readings; with the manual reader the clock is manual only. */
export function createController(now: () => number = () => performance.now(), reader: ShellReader = manualReader): Controller {
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
  const following = (): boolean => state.loaded?.link.mode === "following";
  // A reader with a helper runs it only while the instructor follows the music.
  const tellReader = (): void => reader.setFollowing?.(following());
  const push = (): void => {
    const wc = target();
    if (wc && !wc.isDestroyed() && !wc.isCrashed()) wc.send(CH_UPDATE, snapshot());
  };

  return {
    snapshot,
    open(fileName, text) {
      const before = state.loadId;
      state = openText(state, fileName, text, classSchema, now(), reader.kind !== "manual");
      // Following is the instructor's choice: a newly opened class is on the manual clock until
      // "Follow the music" is picked, so no reader reads anything before that.
      if (state.loadId !== before) state = command(state, { type: "manual" }, now());
      tellReader();
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
      tellReader();
      push();
      return snapshot();
    },
    music(action) {
      if (following()) reader.control?.(action);
      return snapshot();
    },
    attach(t) {
      target = t;
      if (timer === null) timer = setInterval(push, PUSH_EVERY_MS);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      reader.close?.();
    },
  };
}
