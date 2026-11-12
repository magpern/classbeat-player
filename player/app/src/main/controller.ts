// Holds the shell's state and sends snapshots to the presenter. The clock reads the monotonic
// performance.now(), so a change of the system clock never moves class time.
import { performance } from "node:perf_hooks";
import type { WebContents } from "electron";
import classSchema from "../../../../schema/class-format/v1/class.schema.json" with { type: "json" };
import { CH_UPDATE } from "../core/channels.ts";
import type { ClockCommand } from "../core/commands.ts";
import { advance, command, INITIAL, isFollowing, openText, refuse, snapshotOf, transportFor, withoutReader } from "../core/player-state.ts";
import type { PlayerState } from "../core/player-state.ts";
import { manualReader } from "../core/link/reader.ts";
import type { MusicReader } from "../core/link/reader.ts";
import type { MusicTransport, TransportAction } from "../core/link/transport.ts";
import type { Snapshot } from "../core/snapshot.ts";

const PUSH_EVERY_MS = 100;

export interface Controller {
  snapshot(): Snapshot;
  open(fileName: string, text: string): Snapshot;
  refuse(message: string): Snapshot;
  command(cmd: ClockCommand): Snapshot;
  /** A named command for the music app; ignored unless the instructor follows the music. */
  music(action: TransportAction): Snapshot;
  attach(target: () => WebContents | null): void;
  stop(): void;
}

/**
 * The reader is the music link's source of readings; with the manual reader the clock is manual
 * only. A reader that asks the system (one with `setActive`) is on only while the instructor
 * follows the music, and with it a class opens on the manual clock until Follow is picked. A
 * reader that says following is unavailable on this computer counts as no reader from then on.
 */
export function createController(now: () => number = () => performance.now(), reader: MusicReader = manualReader, transport: MusicTransport | null = null): Controller {
  let state: PlayerState = INITIAL;
  let timer: NodeJS.Timeout | null = null;
  let target: () => WebContents | null = () => null;

  // Every snapshot follows the music first, so a snapshot taken between ticks never shows a clock
  // that ran past a window's end.
  const snapshot = (): Snapshot => {
    const t = now();
    // Also right after a class is opened: every snapshot asks, so the reason is always shown.
    if (reader.unavailable?.() === true) state = withoutReader(state);
    state = advance(state, t, reader.latest(t));
    return snapshotOf(state, t);
  };
  const onDemand = reader.setActive !== undefined;
  const sync = (): void => reader.setActive?.(isFollowing(state));
  const push = (): void => {
    const wc = target();
    if (wc && !wc.isDestroyed() && !wc.isCrashed()) wc.send(CH_UPDATE, snapshot());
  };

  return {
    snapshot,
    open(fileName, text) {
      state = openText(state, fileName, text, classSchema, now(), reader.kind !== "manual", !onDemand);
      sync();
      push();
      return snapshot();
    },
    refuse(message) {
      state = refuse(state, message);
      push();
      return snapshot();
    },
    command(cmd) {
      // While following, Pause, Resume and Next go to the music instead of the clock.
      const action = transportFor(state, cmd, transport !== null);
      if (action !== null) transport?.send(action);
      state = command(state, cmd, now(), transport !== null);
      sync();
      push();
      return snapshot();
    },
    music(action) {
      if (transport !== null && isFollowing(state)) transport.send(action);
      return snapshot();
    },
    attach(t) {
      target = t;
      if (timer === null) timer = setInterval(push, PUSH_EVERY_MS);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      reader.setActive?.(false);
    },
  };
}
