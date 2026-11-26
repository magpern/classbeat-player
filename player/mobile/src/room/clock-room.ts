// The phone's `window.room` (issue #871): the room screen's calls (player/app/src/renderer/room.ts)
// served by the shared player core (core/player-reducers.ts, which carries no schema checker), as
// the desktop's main process serves them (main/controller.ts, main/room/room-handlers.ts), on the
// manual clock only. There is no music reader, so Follow does
// nothing and the link says it is not available; no live session, so the remote slot is absent;
// no mix audio. The clock reads the injected `now`, so tests drive it with fake time.
import type { ClockCommand } from "../../../app/src/core/commands.ts";
import { advance, command, INITIAL, openDocument, snapshotOf } from "../../../app/src/core/player-reducers.ts";
import type { PlayerState } from "../../../app/src/core/player-reducers.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { roomFrameOf } from "../../../app/src/core/room/frame.ts";
import type { RoomFrame } from "../../../app/src/core/room/frame.ts";
import { REMOTE_ABSENT } from "../../../app/src/core/room/remote.ts";
import type { RemoteView } from "../../../app/src/core/room/remote.ts";

/** How often the room screen is sent a frame while it shows: the desktop's rate. */
export const PUSH_EVERY_MS = 100;

export interface ClockRoomDeps {
  readonly now: () => number;
  /** Runs [fn] every [ms] until the returned stop is called. */
  readonly every: (fn: () => void, ms: number) => () => void;
  /** Calls [fn] once as the page closes (pagehide). */
  readonly onClose: (fn: () => void) => void;
  /** End class: back to the class list. */
  readonly leave: () => void;
}

export interface ClockRoom {
  state(): Promise<RoomFrame>;
  onUpdate(cb: (frame: RoomFrame) => void): void;
  start(): Promise<RoomFrame>;
  pause(): Promise<RoomFrame>;
  resume(): Promise<RoomFrame>;
  previous(): Promise<RoomFrame>;
  next(): Promise<RoomFrame>;
  forward(): Promise<RoomFrame>;
  back(): Promise<RoomFrame>;
  undo(): Promise<RoomFrame>;
  follow(): Promise<RoomFrame>;
  endClass(): Promise<boolean>;
  remoteState(): Promise<RemoteView>;
  startRemote(): Promise<RemoteView>;
  onRemote(cb: (v: RemoteView) => void): void;
  onMix(cb: (cue: unknown) => void): void;
  mixReport(): Promise<null>;
}

/** The room for a class checked by class-answer.ts, on the manual clock. */
export function clockRoom(fileName: string, doc: Class, deps: ClockRoomDeps): ClockRoom {
  let s: PlayerState = openDocument(INITIAL, fileName, doc, deps.now(), false);
  const frame = (): RoomFrame => {
    const t = deps.now();
    s = advance(s, t);
    return roomFrameOf(snapshotOf(s, t));
  };
  const run = (cmd: ClockCommand): Promise<RoomFrame> => {
    s = command(s, cmd, deps.now());
    return Promise.resolve(frame());
  };
  const listeners: ((f: RoomFrame) => void)[] = [];
  // The push timer starts with the first listener and stops for good when the class ends or the
  // page closes, so nothing keeps reading the clock behind a page that is gone.
  let pushing: "no" | "yes" | "stopped" = "no";
  let stopPush = (): void => {};
  const stop = (): void => {
    pushing = "stopped";
    stopPush();
  };
  deps.onClose(stop);
  return {
    state: () => Promise.resolve(frame()),
    onUpdate(cb) {
      listeners.push(cb);
      if (pushing !== "no") return;
      pushing = "yes";
      stopPush = deps.every(() => {
        const f = frame();
        for (const l of listeners) l(f);
      }, PUSH_EVERY_MS);
    },
    start: () => run({ type: "start" }),
    pause: () => run({ type: "pause" }),
    resume: () => run({ type: "resume" }),
    previous: () => run({ type: "previous" }),
    next: () => run({ type: "next" }),
    forward: () => run({ type: "jump", deltaMs: 5000 }),
    back: () => run({ type: "jump", deltaMs: -5000 }),
    undo: () => run({ type: "undo" }),
    // No reader on the phone yet: the core leaves the manual clock as it is.
    follow: () => run({ type: "follow" }),
    endClass() {
      stop();
      deps.leave();
      return Promise.resolve(true);
    },
    remoteState: () => Promise.resolve(REMOTE_ABSENT),
    startRemote: () => Promise.resolve(REMOTE_ABSENT),
    onRemote: () => {},
    onMix: () => {},
    mixReport: () => Promise.resolve(null),
  };
}
