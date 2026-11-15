// The room frame says when the "Playlist not loaded" notice shows (issue #537): the same decision as
// the presenter's (`playlistNoticeAt`, 30 s, following, quiet link states), read from the real
// controller. A frame that drops the field fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { roomFrameOf } from "../../src/core/room/frame.ts";
import type { LoadOutcome } from "../../src/core/link/playlist.ts";
import type { MusicReader, MusicTransport, Observation } from "../../src/core/link/index.ts";
import { createController } from "../../src/main/controller.ts";
import { CONVERTER_FIXTURES } from "./fixtures.ts";

const WITH = readFileSync(join(CONVERTER_FIXTURES, "class-30min-spotify-playlist.expected.json"), "utf8");
const doc = JSON.parse(WITH) as { music: Record<string, unknown>; songs: { title: string; artist: string; length_ms: number }[] };
const WITHOUT = JSON.stringify({ ...doc, music: { ...doc.music, spotify_playlist: undefined } });
const song = (i: number, at: number): Observation => ({ title: doc.songs[i].title, artist: doc.songs[i].artist, lengthMs: doc.songs[i].length_ms, positionMs: 0, playing: true, at, seenAt: at });

interface Fake extends MusicReader, MusicTransport {
  obs: Observation | null;
  readonly pending: ((o: LoadOutcome) => void)[];
}
const fake = (loads = true): Fake => {
  const self: Fake = { kind: "fake", obs: null, pending: [], latest: () => self.obs, send: () => undefined };
  if (loads) Object.assign(self, { loadPlaylist: (_id: string, done: (o: LoadOutcome) => void) => void self.pending.push(done) });
  return self;
};

function shell(text = WITH, f = fake()) {
  const clock = { t: 1000 };
  const c = createController(() => clock.t, f, f);
  c.open("class.json", text);
  return { f, c, clock };
}

/** The frame's field against the presenter's notice, then the expected value. */
function check(c: ReturnType<typeof createController>, expected: boolean, why: string): void {
  const snap = c.snapshot();
  const frame = roomFrameOf(snap);
  assert.equal(frame.playlistNotLoaded, snap.link?.playlistNotLoaded, `${why}: the frame equals the presenter's notice`);
  assert.equal(frame.playlistNotLoaded, expected, why);
}

test("not loaded: the frame says so, for 30 s, then not", () => {
  const { c, clock } = shell(WITH, fake(false));
  c.command({ type: "start" });
  check(c, true, "just after Start");
  clock.t = 1000 + 29_999;
  check(c, true, "before 30 s");
  clock.t = 1000 + 30_000;
  check(c, false, "after 30 s");
});

test("a class with no playlist: the frame says not loaded", () => {
  const { c } = shell(WITHOUT);
  c.command({ type: "start" });
  check(c, true, "no playlist");
});

test("a fault state wins: the frame does not say it", () => {
  const { f, c, clock } = shell();
  c.command({ type: "start" });
  f.pending[0]("asked");
  clock.t = 1500;
  f.obs = { ...song(0, clock.t), title: "Something else", artist: "Someone" };
  assert.equal(c.snapshot().link?.state, "Off the list");
  check(c, false, "fault state");
});

test("loaded: the frame says nothing", () => {
  const { f, c, clock } = shell();
  c.command({ type: "start" });
  f.pending[0]("asked");
  clock.t = 1300;
  f.obs = song(0, clock.t);
  check(c, false, "loaded");
  clock.t += 60_000;
  f.obs = song(0, clock.t);
  check(c, false, "loaded, later");
});

test("the manual clock never says it", () => {
  const f = fake();
  const mac = Object.assign(f, { setActive: () => undefined });
  const clock = { t: 1000 };
  const c = createController(() => clock.t, mac, mac);
  c.open("class.json", WITH);
  c.command({ type: "start" });
  check(c, false, "manual clock");
});

test("pause and resume after the 30 s do not bring it back, and no class means false", () => {
  const { c, clock } = shell(WITH, fake(false));
  c.command({ type: "start" });
  clock.t += 31_000;
  c.command({ type: "pause" });
  c.command({ type: "resume" });
  check(c, false, "after resume");
  const empty = createController(() => 1, fake(), fake());
  assert.equal(roomFrameOf(empty.snapshot()).playlistNotLoaded, false, "no class, no link");
});

test("the frame carries the field itself (a dropped field fails)", () => {
  const { c } = shell(WITH, fake(false));
  c.command({ type: "start" });
  const frame = roomFrameOf(c.snapshot());
  assert.ok(Object.keys(frame).includes("playlistNotLoaded"));
  assert.equal(frame.playlistNotLoaded, true);
});
