// The room screen's follow tests' fakes (issues #872, #884): a scripted native follower that answers
// the follow intents, and a room opened with the app's own reader and access ask over it. No phone,
// no music app, no network: native code is a script.
import assert from "node:assert/strict";
import type { RoomFrame } from "../../app/src/core/room/frame.ts";
import { createAndroidReader } from "../src/follow/android-reader.ts";
import type { ClockRoom, RoomFollower } from "../src/room/clock-room.ts";
import { createFollowAsk } from "../src/room/follow-ask.ts";
import type { SheetKind } from "../src/room/follow-ask.ts";
import type { RoomFollowSource } from "../src/room/follow-source.ts";
import { openRoom } from "../src/room/open-room.ts";
import { classDoc, harness, type Harness } from "./room-fakes.ts";

/** What Spotify plays, as native code reports it: the position at `since`. */
export interface Music {
  title: string;
  artist: string;
  pos: number;
  playing: boolean;
  since: number;
}

export interface FakeNative extends RoomFollowSource {
  /** Every intent called, in order. */
  readonly calls: string[];
  granted: boolean;
  music: Music | null;
  /** The reading call fails (native code does not answer). */
  quiet: boolean;
  /** Native code says access was taken back. */
  revoked: boolean;
  /** The follow call fails (native code does not answer it). */
  followFails: boolean;
  /** Native code says it stopped following (`{state: "stopped"}`), access still there. */
  nativeStopped: boolean;
}

export function fakeNative(now: () => number): FakeNative {
  const n: FakeNative = {
    calls: [],
    granted: false,
    music: null,
    quiet: false,
    revoked: false,
    followFails: false,
    nativeStopped: false,
    followAccess: async () => (n.calls.push("followAccess"), { granted: n.granted }),
    openFollowSetting: async () => (n.calls.push("openFollowSetting"), { opened: true }),
    follow: async () => {
      n.calls.push("follow");
      if (n.followFails) throw new Error("no answer");
      return { state: n.granted ? "following" : "noAccess" };
    },
    unfollow: async () => (n.calls.push("unfollow"), { state: "stopped" }),
    reading: async () => {
      n.calls.push("reading");
      if (n.revoked) return { state: "noAccess" };
      if (n.nativeStopped) return { state: "stopped" };
      if (n.quiet) throw new Error("no answer");
      const m = n.music;
      if (m === null) return { state: "nothing" };
      return { state: "reading", reading: { trackId: null, title: m.title, artist: m.artist, lengthMs: 234_000, playing: m.playing, positionMs: m.pos, ageMs: now() - m.since } };
    },
    sendPlay: async () => (n.calls.push("sendPlay"), { state: "sent" }),
    sendPause: async () => (n.calls.push("sendPause"), { state: "sent" }),
    sendNext: async () => (n.calls.push("sendNext"), { state: "sent" }),
  };
  return n;
}

export interface Run {
  h: Harness;
  room: ClockRoom;
  native: FakeNative;
  /** The sheet's kind while it shows, else null. */
  sheet(): SheetKind | null;
  /** Android's setting closed: the app is back in front. */
  back(): void;
  openSetting(): void;
  notNow(): void;
  /** Moves fake time on in 100 ms steps, letting native code answer between them. */
  wait(ms: number): Promise<void>;
}

export const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
export const sends = (n: FakeNative): string[] => n.calls.filter((c) => c.startsWith("send"));

export async function opened(): Promise<Run> {
  const h = harness(() => Promise.resolve({ document: classDoc() }));
  const native = fakeNative(() => h.deps.now());
  let shown: SheetKind | null = null;
  const returns: (() => void)[] = [];
  const ask = createFollowAsk({
    access: () => native.followAccess(),
    openSetting: () => native.openFollowSetting(),
    sheet: { show: (k) => void (shown = k), hide: () => void (shown = null), isOpen: () => shown !== null },
    onReturn: (fn) => void returns.push(fn),
  });
  const follower = (): RoomFollower => ({ reader: createAndroidReader(native, h.deps), press: (on) => ask.press(on) });
  assert.equal(await openRoom({ ...h.deps, follower }), "open");
  return {
    h,
    room: h.installed[0],
    native,
    sheet: () => shown,
    back: () => returns.forEach((fn) => fn()),
    openSetting: () => ask.openSetting(),
    notNow: () => ask.notNow(),
    async wait(ms) {
      for (let done = 0; done < ms; done += 100) {
        h.tick(100);
        await flush();
      }
      await flush();
    },
  };
}

export const linkOf = (f: RoomFrame): [string | undefined, string | undefined, boolean | undefined] => [f.link?.mode, f.link?.state, f.followKey];
export const play = (r: Run, n: number, pos = 0): void => {
  r.native.music = { title: `Song ${n}`, artist: `Artist ${n}`, pos, playing: true, since: r.h.deps.now() };
};

/** Access given before Follow: following goes on at the press, no sheet. */
export async function following(): Promise<Run> {
  const r = await opened();
  r.native.granted = true;
  await r.room.follow();
  await r.wait(100);
  return r;
}
