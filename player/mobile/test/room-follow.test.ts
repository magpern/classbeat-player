// The room screen follows the music on the phone (issue #872, docs/design/app-follow.md): a fake
// native follower answers the follow intents, the phone's reader and Follow's access ask are the
// app's own (follow/android-reader.ts, room/follow-ask.ts), and the room's frames are the shared
// core's. Each state of app-follow.md is reached here; the shots draw them. No phone, no music app,
// no network: native code is a script.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LINK_CONFIG } from "../../app/src/core/link/types.ts";
import type { RoomFrame } from "../../app/src/core/room/frame.ts";
import { createAndroidReader } from "../src/follow/android-reader.ts";
import type { ClockRoom, RoomFollower } from "../src/room/clock-room.ts";
import { createFollowAsk } from "../src/room/follow-ask.ts";
import type { SheetKind } from "../src/room/follow-ask.ts";
import type { RoomFollowSource } from "../src/room/follow-source.ts";
import { openRoom } from "../src/room/open-room.ts";
import { classDoc, harness, type Harness } from "./room-fakes.ts";

/** What Spotify plays, as native code reports it: the position at `since`. */
interface Music {
  title: string;
  artist: string;
  pos: number;
  playing: boolean;
  since: number;
}

interface FakeNative extends RoomFollowSource {
  /** Every intent called, in order. */
  readonly calls: string[];
  granted: boolean;
  music: Music | null;
  /** The reading call fails (native code does not answer). */
  quiet: boolean;
  /** Native code says access was taken back. */
  revoked: boolean;
}

function fakeNative(now: () => number): FakeNative {
  const n: FakeNative = {
    calls: [],
    granted: false,
    music: null,
    quiet: false,
    revoked: false,
    followAccess: async () => (n.calls.push("followAccess"), { granted: n.granted }),
    openFollowSetting: async () => (n.calls.push("openFollowSetting"), { opened: true }),
    follow: async () => (n.calls.push("follow"), { state: n.granted ? "following" : "noAccess" }),
    unfollow: async () => (n.calls.push("unfollow"), { state: "stopped" }),
    reading: async () => {
      n.calls.push("reading");
      if (n.revoked) return { state: "noAccess" };
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

interface Run {
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

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
const sends = (n: FakeNative): string[] => n.calls.filter((c) => c.startsWith("send"));

async function opened(): Promise<Run> {
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

const linkOf = (f: RoomFrame): [string | undefined, string | undefined, boolean | undefined] => [f.link?.mode, f.link?.state, f.followKey];
const play = (r: Run, n: number, pos = 0): void => {
  r.native.music = { title: `Song ${n}`, artist: `Artist ${n}`, pos, playing: true, since: r.h.deps.now() };
};

/** Access given before Follow: following goes on at the press, no sheet. */
async function following(): Promise<Run> {
  const r = await opened();
  r.native.granted = true;
  await r.room.follow();
  await r.wait(100);
  return r;
}

test("manual: the class opens on the manual clock with Follow offered, and nothing native is asked", async () => {
  const r = await opened();
  const f = await r.room.state();
  assert.deepEqual(linkOf(f), ["manual", "Manual", true]);
  // The phone's words never say "F to follow": the band's key stands in.
  assert.equal(f.link?.available, false);
  await r.room.start();
  await r.wait(5_000);
  assert.deepEqual(linkOf(await r.room.state()), ["manual", "Manual", true]);
  assert.deepEqual(r.native.calls, [], "no access check, no reading, no command before Follow");
});

test("access refused: the sheet asks; still off after the setting; Not now keeps the manual clock", async () => {
  const r = await opened();
  await r.room.follow();
  await flush();
  assert.equal(r.sheet(), "ask");
  assert.deepEqual(linkOf(await r.room.state()), ["manual", "Manual", true]);
  // A second press while the sheet shows asks nothing more.
  await r.room.follow();
  await flush();
  assert.deepEqual(r.native.calls, ["followAccess"]);
  r.openSetting();
  r.back();
  await flush();
  assert.equal(r.sheet(), "still-off");
  r.notNow();
  assert.equal(r.sheet(), null);
  assert.deepEqual(linkOf(await r.room.state()), ["manual", "Manual", true]);
  assert.deepEqual(r.native.calls, ["followAccess", "openFollowSetting", "followAccess"], "never follow, never a reading, never a command");
});

test("waiting for the first song: access given in the setting closes the sheet and follows", async () => {
  const r = await opened();
  await r.room.follow();
  await flush();
  r.openSetting();
  r.native.granted = true;
  r.back();
  await r.wait(100);
  assert.equal(r.sheet(), null);
  const f = await r.room.state();
  assert.deepEqual(linkOf(f), ["following", "Manual", false], "following before the first lock; Follow is gone");
  assert.ok(r.native.calls.includes("follow"));
});

test("following: a song change locks, a pause pauses, stale readings coast", async () => {
  const r = await following();
  await r.room.start();
  play(r, 2, 0);
  await r.wait(1_000);
  let f = await r.room.state();
  assert.equal(f.link?.state, "Locked");
  assert.ok(Math.abs((f.view?.classMs ?? 0) - 225_000) < 10_000, `locked to song 2: ${f.view?.classMs}`);
  r.native.music = { ...(r.native.music as Music), pos: 1_000, playing: false, since: r.h.deps.now() };
  await r.wait(1_000);
  assert.equal((await r.room.state()).link?.state, "Paused");
  play(r, 2, 1_000);
  await r.wait(1_000);
  assert.equal((await r.room.state()).link?.state, "Locked");
  r.native.quiet = true;
  await r.wait(DEFAULT_LINK_CONFIG.staleMs + 1_000);
  f = await r.room.state();
  assert.equal(f.link?.state, "Coasting");
  assert.equal(f.followKey, false);
});

test("each band press while following sends exactly one command; none on the manual clock", async () => {
  const manual = await opened();
  await manual.room.start();
  await manual.room.pause();
  await manual.room.resume();
  await manual.room.next();
  await manual.wait(1_000);
  assert.deepEqual(sends(manual.native), []);

  const r = await following();
  await r.room.start();
  // Nothing goes before native code's first answer since following began (reader-lifecycle.ts).
  assert.deepEqual(sends(r.native), []);
  await r.wait(1_000);
  assert.deepEqual(sends(r.native), ["sendPlay"]);
  play(r, 1, 0);
  await r.wait(1_000);
  // No frame was asked for since the lock: the press itself must see it.
  await r.room.pause();
  await r.wait(100);
  assert.deepEqual(sends(r.native), ["sendPlay", "sendPause"]);
  r.native.music = { ...(r.native.music as Music), playing: false, since: r.h.deps.now() };
  await r.wait(1_000);
  await r.room.resume();
  await r.wait(100);
  assert.deepEqual(sends(r.native), ["sendPlay", "sendPause", "sendPlay"]);
  play(r, 1, 2_000);
  await r.wait(1_000);
  await r.room.next();
  await r.wait(100);
  assert.deepEqual(sends(r.native), ["sendPlay", "sendPause", "sendPlay", "sendNext"]);
  // Previous is not a music command: the clock goes manual, announced, and nothing is sent.
  await r.room.previous();
  await r.wait(100);
  assert.deepEqual(sends(r.native), ["sendPlay", "sendPause", "sendPlay", "sendNext"]);
  assert.equal((await r.room.state()).link?.mode, "manual");
  await r.room.pause();
  await r.wait(100);
  assert.deepEqual(sends(r.native), ["sendPlay", "sendPause", "sendPlay", "sendNext"], "nothing once following has stopped");
});

test("Start never asks for the class playlist, and says it was not loaded while following", async () => {
  const r = await following();
  const f = await r.room.start();
  assert.equal(f.playlistNotLoaded, true);
  assert.ok(!r.native.calls.some((c) => /playlist|load/i.test(c)));
});

test("access taken back while following: Following stopped for 30 s, then the manual clock with Follow", async () => {
  const r = await following();
  await r.room.start();
  play(r, 1, 0);
  await r.wait(1_000);
  assert.equal((await r.room.state()).link?.state, "Locked");
  const before = (await r.room.state()).view?.classMs ?? 0;
  r.native.revoked = true;
  await r.wait(600);
  let f = await r.room.state();
  assert.equal(f.link?.mode, "manual");
  assert.notEqual(f.link?.announcement ?? null, null, "Following stopped");
  assert.equal(f.followKey, true);
  assert.equal(f.view?.status, "running", "the clock goes on by hand at once");
  assert.ok((f.view?.classMs ?? 0) >= before);
  const readings = r.native.calls.filter((c) => c === "reading").length;
  await r.wait(DEFAULT_LINK_CONFIG.undoWindowMs + 1_000);
  f = await r.room.state();
  assert.equal(f.link?.announcement ?? null, null);
  assert.deepEqual(linkOf(f), ["manual", "Manual", true]);
  assert.equal(r.native.calls.filter((c) => c === "reading").length, readings, "no reading once stopped");
});

test("End and leaving the page stop following", async () => {
  const r = await following();
  await r.wait(1_000);
  await r.room.endClass();
  assert.equal(r.native.calls.at(-1), "unfollow");
  const p = await following();
  p.h.close();
  assert.equal(p.native.calls.at(-1), "unfollow");
  const n = p.native.calls.length;
  await p.wait(2_000);
  assert.equal(p.native.calls.length, n, "nothing asked after the page closed");
});
