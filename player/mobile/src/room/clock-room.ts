// The phone's `window.room` (issue #871): the room screen's calls (player/app/src/renderer/room.ts)
// served by the shared player core (core/player-reducers.ts, which carries no schema checker), as
// the desktop's main process serves them (main/controller.ts, main/room/room-handlers.ts), on the
// manual clock until the instructor picks Follow (issue #872, app-follow.md). With a follower, the
// band's Follow asks for access (follow-ask.ts) and the clock then follows the phone's reader by the
// desktop's rules: each frame reads it, each press while following that the music answers goes to
// it as play, pause or next, and nothing goes to it otherwise. No live session, so the remote slot
// is absent; no mix audio. The clock reads the injected `now`, so tests drive it with fake time.
import type { ClockCommand } from "../../../app/src/core/commands.ts";
import { advance, command, INITIAL, isFollowing, openDocument, playlistAtStart, readerStopped, snapshotOf, transportFor, withoutReader } from "../../../app/src/core/player-reducers.ts";
import type { PlayerState } from "../../../app/src/core/player-reducers.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import type { AndroidReader } from "../follow/android-reader.ts";
import { roomFrameOf } from "../../../app/src/core/room/frame.ts";
import type { RoomFrame } from "../../../app/src/core/room/frame.ts";
import { REMOTE_ABSENT } from "../../../app/src/core/room/remote.ts";
import type { RemoteView } from "../../../app/src/core/room/remote.ts";

/** How often the room screen is sent a frame while it shows: the desktop's rate. */
export const PUSH_EVERY_MS = 100;

/** The phone's follower (phone-follower.ts): the reader, and Follow's access ask. */
export interface RoomFollower {
  readonly reader: AndroidReader;
  /** Follow pressed: [turnOn] runs once Notification access is there (follow-ask.ts). */
  press(turnOn: () => void): void;
}

export interface ClockRoomDeps {
  readonly now: () => number;
  /** Runs [fn] every [ms] until the returned stop is called. */
  readonly every: (fn: () => void, ms: number) => () => void;
  /** Calls [fn] once as the page closes (pagehide). */
  readonly onClose: (fn: () => void) => void;
  /** End class: back to the class list. */
  readonly leave: () => void;
  /** The phone's follower; without one the class stays on the manual clock. */
  readonly follower?: () => RoomFollower;
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

/** The room for a class checked by class-answer.ts, on the manual clock until Follow. */
export function clockRoom(fileName: string, doc: Class, deps: ClockRoomDeps): ClockRoom {
  const follower = deps.follower?.() ?? null;
  const reader = follower?.reader ?? null;
  const canSend = reader !== null;
  let s: PlayerState = openDocument(INITIAL, fileName, doc, deps.now(), canSend, false);
  // The reader asks native code for readings only while the clock follows the music.
  const sync = (): void => reader?.setActive?.(isFollowing(s));
  // Brings the state up to now with what the reader has heard since the last frame.
  const catchUp = (t: number): void => {
    if (reader?.unavailable?.() === true) s = withoutReader(s);
    // Access taken back while following, or native code stopped following or would not start it:
    // the clock goes on by hand at once, announced (app-follow.md), and never coasts on a reader
    // that asks nothing more.
    if (isFollowing(s) && (reader?.reason?.() === "not-permitted" || reader?.stopped() === true)) {
      s = readerStopped(s, t);
      sync();
    }
    s = advance(s, t, reader?.latest(t) ?? null);
  };
  const frame = (): RoomFrame => {
    const t = deps.now();
    catchUp(t);
    return phoneFrame(roomFrameOf(snapshotOf(s, t, canSend, reader?.reason?.() ?? null)));
  };
  const run = (cmd: ClockCommand): Promise<RoomFrame> => {
    const t = deps.now();
    // A press is routed on the state as it is now, not as the last frame left it (a lock since).
    catchUp(t);
    // Start with a playlist stays off in the app (app-follow.md): the follower never loads one.
    s = playlistAtStart(s, cmd, t, canSend, false).state;
    const action = transportFor(s, cmd, canSend);
    if (reader !== null && action !== null) reader.send(action);
    s = command(s, cmd, t, canSend);
    sync();
    return Promise.resolve(frame());
  };
  // Follow works only while the band offers its key; the core then follows once access is there.
  // Access may come much later (back from Android's setting), so the key is checked again then: a
  // class that ended, or a clock no longer manual, meanwhile does not start following.
  const follow = (): Promise<RoomFrame> => {
    if (follower !== null && frame().followKey === true) {
      follower.press(() => {
        if (frame().followKey !== true) return;
        s = command(s, { type: "follow" }, deps.now(), canSend);
        sync();
      });
    }
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
    reader?.setActive?.(false);
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
    follow,
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

/**
 * The phone's frame: the link words never say "F to follow" (no keyboard; the band's Follow key
 * stands in, app-follow.md), and the key shows while the clock is manual, the music could be
 * followed and the class has not ended.
 */
function phoneFrame(f: RoomFrame): RoomFrame {
  const link = f.link;
  if (link === null) return f;
  const followKey = link.available && link.mode === "manual" && f.view?.status !== "ended";
  return { ...f, link: { ...link, available: false }, followKey };
}
