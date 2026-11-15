// Start loads the class playlist, in the shell (issue #488, ADR 0001 "Start loads the class
// playlist"): the controller with a fake follower that records each load and answers as a test
// says. Only Start at class time 0 loads it, the load never holds up the clock, a load that did
// not go presses play as before, and the notice shows only when a class's playlist was not loaded.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PLAYLIST_CONFIRM_MS } from "../../src/core/link/playlist-load.ts";
import type { LoadOutcome } from "../../src/core/link/playlist.ts";
import type { MusicReader, MusicTransport, Observation, TransportAction } from "../../src/core/link/index.ts";
import { createController } from "../../src/main/controller.ts";
import { CONVERTER_FIXTURES } from "./fixtures.ts";

const WITH = readFileSync(join(CONVERTER_FIXTURES, "class-30min-spotify-playlist.expected.json"), "utf8");
const doc = JSON.parse(WITH) as { music: Record<string, unknown>; songs: { title: string; artist: string; length_ms: number }[] };
const ID = doc.music.spotify_playlist as string;
const WITHOUT = JSON.stringify({ ...doc, music: { ...doc.music, spotify_playlist: undefined } });
const song = (i: number, at: number): Observation => ({ title: doc.songs[i].title, artist: doc.songs[i].artist, lengthMs: doc.songs[i].length_ms, positionMs: 0, playing: true, at, seenAt: at });

interface Fake extends MusicReader, MusicTransport {
  obs: Observation | null;
  readonly sent: TransportAction[];
  readonly requests: string[];
  /** The answers not given yet, oldest first. */
  readonly pending: ((o: LoadOutcome) => void)[];
}

/** A follower; with `loads` false it cannot load a playlist (like the Windows follower today). */
function fake(loads = true): Fake {
  const self: Fake = { kind: "fake", obs: null, sent: [], requests: [], pending: [], latest: () => self.obs, send: (a) => void self.sent.push(a) };
  if (loads) Object.assign(self, { loadPlaylist: (id: string, done: (o: LoadOutcome) => void) => void (self.requests.push(id), self.pending.push(done)) });
  return self;
}

function shell(text = WITH, f = fake()): { f: Fake; c: ReturnType<typeof createController>; clock: { t: number } } {
  const clock = { t: 1000 };
  const c = createController(() => clock.t, f, f);
  c.open("class.json", text);
  return { f, c, clock };
}

test("Start at class time 0 asks the follower to load the class playlist, and the clock starts at once", () => {
  const { f, c } = shell();
  const snap = c.command({ type: "start" });
  assert.deepEqual(f.requests, [ID]);
  assert.equal(snap.view?.status, "running", "the load never holds up the clock (fire-and-forget)");
  assert.deepEqual(f.sent, [], "the load starts the music itself: play is not pressed over it");
  assert.equal(snap.link?.playlistNotLoaded, false, "nothing is said while the load is under way");
});

test(`a load is confirmed when the first fresh reading is song 1 within ${PLAYLIST_CONFIRM_MS} ms: nothing is said`, () => {
  const { f, c, clock } = shell();
  c.command({ type: "start" });
  clock.t = 1300;
  f.pending[0]("asked");
  clock.t = 1300 + PLAYLIST_CONFIRM_MS;
  f.obs = song(0, clock.t);
  const snap = c.snapshot();
  assert.equal(snap.link?.playlistNotLoaded, false);
  assert.equal(snap.link?.state, "Locked", "and following goes on as before");
  clock.t += 60_000;
  assert.equal(c.snapshot().link?.playlistNotLoaded, false);
});

test("the first fresh reading is another song: the link fault wins and the notice does not appear (presenter.md)", () => {
  const { f, c, clock } = shell();
  c.command({ type: "start" });
  f.pending[0]("asked");
  clock.t = 1500;
  f.obs = { ...song(0, clock.t), title: "Something else", artist: "Someone" };
  const snap = c.snapshot();
  assert.equal(snap.link?.state, "Off the list", "a song the class does not expect, as always");
  assert.equal(snap.link?.playlistNotLoaded, false, "a fault state keeps its plate");
});

test("the notice shows for 30 s after Start, then the link state returns", () => {
  const { c, clock } = shell(WITH, fake(false));
  c.command({ type: "start" });
  assert.equal(c.snapshot().link?.playlistNotLoaded, true);
  clock.t = 1000 + 29_999;
  assert.equal(c.snapshot().link?.playlistNotLoaded, true);
  clock.t = 1000 + 30_000;
  assert.equal(c.snapshot().link?.playlistNotLoaded, false);
});

test("the notice does not come back on Pause and Resume after the 30 s", () => {
  const { c, clock } = shell(WITH, fake(false));
  c.command({ type: "start" });
  clock.t += 31_000;
  c.command({ type: "pause" });
  c.command({ type: "resume" });
  assert.equal(c.snapshot().link?.playlistNotLoaded, false);
});

test("no fresh reading in time (as on Linux, where OpenUri reports nothing): not loaded", () => {
  const { f, c, clock } = shell();
  c.command({ type: "start" });
  f.pending[0]("asked");
  clock.t = 1000 + PLAYLIST_CONFIRM_MS;
  assert.equal(c.snapshot().link?.playlistNotLoaded, false);
  clock.t += 1;
  assert.equal(c.snapshot().link?.playlistNotLoaded, true);
});

test("a follower that never answers: not loaded once the window has passed", () => {
  const { c, clock } = shell();
  c.command({ type: "start" });
  clock.t = 1001 + PLAYLIST_CONFIRM_MS;
  assert.equal(c.snapshot().link?.playlistNotLoaded, true);
});

for (const outcome of ["failed", "not-running", "unsupported"] as LoadOutcome[]) {
  test(`a load that was ${outcome}: not loaded is said, and Start presses play as before`, () => {
    const { f, c } = shell();
    c.command({ type: "start" });
    f.pending[0](outcome);
    assert.deepEqual(f.sent, ["play"]);
    assert.equal(c.snapshot().link?.playlistNotLoaded, true);
    assert.equal(c.snapshot().view?.status, "running");
  });
}

test("a late failed answer never presses play over a newer command, or for a class opened since", () => {
  const paused = shell();
  paused.c.command({ type: "start" });
  paused.c.command({ type: "pause" });
  paused.f.pending[0]("failed");
  assert.deepEqual(paused.f.sent, []);
  assert.equal(paused.c.snapshot().link?.playlistNotLoaded, true);

  const reopened = shell();
  reopened.c.command({ type: "start" });
  reopened.c.open("other.json", WITH);
  reopened.f.pending[0]("failed");
  assert.deepEqual(reopened.f.sent, []);
  assert.equal(reopened.c.snapshot().link?.playlistNotLoaded, false, "the new class has not been started");
});

test("a follower that cannot load a playlist (Windows today): Start presses play as before, and says not loaded", () => {
  const { f, c } = shell(WITH, fake(false));
  c.command({ type: "start" });
  assert.deepEqual(f.sent, ["play"]);
  assert.equal(c.snapshot().link?.playlistNotLoaded, true);
});

test("a class without a playlist: nothing is loaded, Start plays what Spotify has, and the notice shows for the 30 s", () => {
  for (const loads of [true, false]) {
    const { f, c, clock } = shell(WITHOUT, fake(loads));
    c.command({ type: "start" });
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.sent, ["play"]);
    clock.t += 10_000;
    assert.equal(c.snapshot().link?.playlistNotLoaded, true);
    clock.t += 20_000;
    assert.equal(c.snapshot().link?.playlistNotLoaded, false);
  }
});

test("Start after a jump: nothing is loaded and nothing is said", () => {
  const { f, c, clock } = shell();
  c.command({ type: "jump", deltaMs: 5000 });
  c.command({ type: "follow" });
  c.command({ type: "start" });
  assert.deepEqual(f.requests, []);
  clock.t += 10_000;
  assert.equal(c.snapshot().link?.playlistNotLoaded, false);
});

test("only Start loads it: pause, resume, next, a nudge and a second Start never reload it", () => {
  const { f, c, clock } = shell();
  c.command({ type: "start" });
  f.pending[0]("asked");
  clock.t = 1500;
  f.obs = song(0, clock.t);
  assert.equal(c.snapshot().link?.state, "Locked");
  for (const cmd of [{ type: "pause" }, { type: "resume" }, { type: "start" }, { type: "next" }, { type: "jump", deltaMs: 5000 }, { type: "jump", deltaMs: -5000 }, { type: "previous" }, { type: "start" }] as const) {
    clock.t += 100;
    f.obs = song(0, clock.t);
    c.command(cmd);
  }
  c.music("play");
  c.music("pause");
  c.music("next");
  assert.deepEqual(f.requests, [ID], "one load, at the first Start");
  assert.equal(c.snapshot().link?.playlistNotLoaded, false);
});

test("on the manual clock Start loads nothing (the music app is not asked), and nothing is said", () => {
  const f = fake();
  const mac = Object.assign(f, { setActive: () => undefined });
  const clock = { t: 1000 };
  const c = createController(() => clock.t, mac, mac);
  assert.equal(c.open("class.json", WITH).link?.mode, "manual");
  c.command({ type: "start" });
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.sent, []);
  assert.equal(c.snapshot().link?.playlistNotLoaded, false);
  for (const text of [WITH, WITHOUT]) {
    const mf = Object.assign(fake(), { setActive: () => undefined });
    const m = createController(() => 1000, mf, mf);
    m.open("class.json", text);
    m.command({ type: "start" });
    assert.equal(m.snapshot().link?.playlistNotLoaded, false);
  }
});
