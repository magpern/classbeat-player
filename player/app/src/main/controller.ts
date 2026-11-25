// Holds the shell's state and sends snapshots to the presenter (and to watchers: the room window). The clock reads the monotonic
// performance.now(), so a change of the system clock never moves class time.
import { performance } from "node:perf_hooks";
import type { WebContents } from "electron";
import classSchema from "../../../../schema/class-format/v1/class.schema.json" with { type: "json" };
import { CH_UPDATE } from "../core/channels.ts";
import type { ClockCommand } from "../core/commands.ts";
import { advance, alignClock, answerLoad, command, INITIAL, isFollowing, openText, playlistAtStart, refuse, snapshotOf, transportFor, withoutReader } from "../core/player-state.ts";
import { createLoadGate } from "../core/link/load-gate.ts";
import { fallsBack, PLAYLIST_CONFIRM_MS } from "../core/link/playlist-load.ts";
import { canLoadPlaylist } from "../core/link/playlist.ts";
import type { PlaylistLoader } from "../core/link/playlist.ts";
import type { PlayerState } from "../core/player-state.ts";
import { manualReader } from "../core/link/reader.ts";
import type { MusicReader } from "../core/link/reader.ts";
import type { MusicTransport, TransportAction } from "../core/link/transport.ts";
import type { Snapshot } from "../core/snapshot.ts";

const PUSH_EVERY_MS = 100;

export interface Controller {
  snapshot(): Snapshot;
  /** The live session's view of the class (main process only): the state after the music was read, and when. */
  read(): { readonly state: PlayerState; readonly now: number; readonly canSend: boolean };
  open(fileName: string, text: string): Snapshot;
  refuse(message: string): Snapshot;
  command(cmd: ClockCommand): Snapshot;
  /** A named command for the music app; ignored unless the instructor follows the music. */
  music(action: TransportAction): Snapshot;
  /** Mix playback: moves a running clock to this class time (the audio's position minus offset_ms). */
  align(classMs: number): void;
  /** Calls the listener once when the open class's clock reaches its end. */
  onEnded(listener: () => void): void;
  /** Calls the listener each time a class opens for play (a file or a list's class that read). */
  onOpened(listener: () => void): void;
  /** Calls the listener with every snapshot the presenter is pushed, also while no presenter is attached. */
  watch(listener: (s: Snapshot) => void): void;
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
  let endedLoad = 0;
  const enders: (() => void)[] = [];
  const openers: (() => void)[] = [];
  const watchers: ((s: Snapshot) => void)[] = [];
  const snapshot = (): Snapshot => {
    const t = now();
    // Also right after a class is opened: every snapshot asks, so the reason is always shown.
    if (reader.unavailable?.() === true) state = withoutReader(state);
    state = advance(state, t, reader.latest(t));
    const snap = snapshotOf(state, t, transport !== null, reader.reason?.() ?? null);
    if (snap.view?.status === "ended" && endedLoad !== snap.loadId) {
      endedLoad = snap.loadId;
      for (const l of enders) l();
    }
    return snap;
  };
  const onDemand = reader.setActive !== undefined;
  const sync = (): void => reader.setActive?.(isFollowing(state));
  const push = (): void => {
    const wc = target();
    const live = wc && !wc.isDestroyed() && !wc.isCrashed() ? wc : null;
    if (live === null && watchers.length === 0) return;
    const snap = snapshot();
    live?.send(CH_UPDATE, snap);
    for (const w of watchers) w(snap);
  };

  // Only a follower that can load a playlist is ever asked to (macOS, Linux; a test's fake).
  const loader = canLoadPlaylist(transport) ? transport : null;
  /** Counts the instructor's commands, so a late fallback never overrides a newer one. */
  let moves = 0;
  /** Music commands wait here while Start's playlist load is out, so none reaches the music app before it. */
  const gate = createLoadGate((a) => transport?.send(a), PLAYLIST_CONFIRM_MS);
  /**
   * Asks the follower to play the playlist from its first track (that starts the music too). Later
   * music commands wait in the gate until it answers. When the load did not go, Start presses play
   * as before, even when the answer is late (after the 3 s window), unless another class was opened,
   * following stopped or the instructor gave another command meanwhile. The fallback goes out
   * before the commands that were held.
   */
  const load = (to: PlaylistLoader, id: string, fallback: TransportAction | null): void => {
    const loadId = state.loadId;
    const mine = moves;
    const token = gate.hold(now());
    let answered = false;
    to.loadPlaylist(id, (outcome) => {
      if (answered) return; // a follower that answers twice neither presses play twice nor ends another load's hold
      answered = true;
      const back = state.loadId === loadId && state.loaded !== null && fallsBack(state.loaded.playlist, outcome);
      state = answerLoad(state, loadId, outcome, now());
      if (back && fallback !== null && moves === mine && isFollowing(state)) transport?.send(fallback);
      gate.release(token);
    });
  };

  return {
    snapshot,
    read() {
      const t = now();
      if (reader.unavailable?.() === true) state = withoutReader(state);
      state = advance(state, t, reader.latest(t));
      return { state, now: t, canSend: transport !== null };
    },
    open(fileName, text) {
      state = openText(state, fileName, text, classSchema, now(), reader.kind !== "manual", !onDemand);
      sync();
      push();
      const snap = snapshot();
      if (snap.error === null && snap.doc !== null) for (const l of openers) l();
      return snap;
    },
    refuse(message) {
      state = refuse(state, message);
      push();
      return snapshot();
    },
    command(cmd) {
      moves += 1;
      const t = now();
      gate.expire(t);
      // Start at class time 0 of a class with a playlist asks the follower to load it (playlist-load.ts).
      const start = playlistAtStart(state, cmd, t, transport !== null, loader !== null);
      state = start.state;
      // While following, Start, Pause, Resume and Next go to the music instead of the clock (before the first lock, Start goes to both).
      const action = transportFor(state, cmd, transport !== null);
      if (start.ask !== null && loader !== null) load(loader, start.ask, action);
      else if (action !== null) gate.send(action);
      // The load is fire-and-forget: the clock takes the command now, whatever the follower answers.
      state = command(state, cmd, t, transport !== null);
      sync();
      push();
      return snapshot();
    },
    music(action) {
      moves += 1;
      gate.expire(now());
      if (transport !== null && isFollowing(state)) gate.send(action);
      return snapshot();
    },
    align(classMs) {
      state = alignClock(state, classMs, now());
      push();
    },
    onEnded(listener) {
      enders.push(listener);
    },
    onOpened(listener) {
      openers.push(listener);
    },
    watch(listener) {
      watchers.push(listener);
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
