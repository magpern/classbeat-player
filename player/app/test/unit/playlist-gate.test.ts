// The playlist load and the command gate (issue #494, hardening from #492): a Pause sent while the
// load is out never reaches the music app before the load does, a late failed answer still presses
// play (the chosen fallback), and the ready check in playlistAtStart is guarded.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import classSchema from "../../../../schema/class-format/v1/class.schema.json" with { type: "json" };
import { createLoadGate } from "../../src/core/link/load-gate.ts";
import { PLAYLIST_CONFIRM_MS } from "../../src/core/link/playlist-load.ts";
import type { LoadOutcome } from "../../src/core/link/playlist.ts";
import type { MusicReader, MusicTransport } from "../../src/core/link/index.ts";
import { INITIAL, openText, playlistAtStart } from "../../src/core/player-state.ts";
import { createController } from "../../src/main/controller.ts";
import { CONVERTER_FIXTURES } from "./fixtures.ts";

const WITH = readFileSync(join(CONVERTER_FIXTURES, "class-30min-spotify-playlist.expected.json"), "utf8");

/** One ordered log of what reached the music app: the load request and each transport command. */
function rig(): { c: ReturnType<typeof createController>; log: string[]; answer: (o: LoadOutcome) => void; clock: { t: number } } {
  const log: string[] = [];
  const pending: ((o: LoadOutcome) => void)[] = [];
  const f: MusicReader & MusicTransport = { kind: "fake", latest: () => null, send: (a) => void log.push(a) };
  Object.assign(f, { loadPlaylist: (_id: string, done: (o: LoadOutcome) => void) => void (log.push("load"), pending.push(done)) });
  const clock = { t: 1000 };
  const c = createController(() => clock.t, f, f);
  c.open("class.json", WITH);
  return { c, log, answer: (o) => pending[0](o), clock };
}

test("a Pause sent while the load is out reaches the music app only after the load", () => {
  const { c, log, answer } = rig();
  c.command({ type: "start" });
  c.music("pause");
  assert.deepEqual(log, ["load"], "the Pause is held while the load is out");
  answer("asked");
  assert.deepEqual(log, ["load", "pause"], "the load first, then the Pause");
});

test("a Pause after a failed load: no play over it, then the Pause", () => {
  const { c, log, answer } = rig();
  c.command({ type: "start" });
  c.music("pause");
  answer("failed");
  assert.deepEqual(log, ["load", "pause"]);
});

test("held music controls go out in the order given", () => {
  const { c, log, answer } = rig();
  c.command({ type: "start" });
  c.music("pause");
  c.music("next");
  assert.deepEqual(log, ["load"]);
  answer("asked");
  assert.deepEqual(log, ["load", "pause", "next"]);
});

test("a load that never answers stops holding after the window, so a Pause is never stuck", () => {
  const { c, log, clock } = rig();
  c.command({ type: "start" });
  clock.t += PLAYLIST_CONFIRM_MS;
  c.music("pause");
  assert.deepEqual(log, ["load"], "still inside the window: held");
  clock.t += 1;
  c.music("next");
  assert.deepEqual(log, ["load", "pause", "next"], "past the window: the held Pause is released first, then this one");
});

test("a failed answer after the 3 s window still presses play (the fallback), when nothing newer came", () => {
  const { c, log, answer, clock } = rig();
  c.command({ type: "start" });
  clock.t += PLAYLIST_CONFIRM_MS + 500;
  assert.equal(c.snapshot().link?.playlistNotLoaded, true);
  answer("failed");
  assert.deepEqual(log, ["load", "play"]);
});

test("a late answer sends no play when a newer command came, or when Spotify took the load", () => {
  const newer = rig();
  newer.c.command({ type: "start" });
  newer.c.music("pause");
  newer.clock.t += PLAYLIST_CONFIRM_MS + 500;
  newer.answer("failed");
  assert.deepEqual(newer.log, ["load", "pause"]);

  const taken = rig();
  taken.c.command({ type: "start" });
  taken.clock.t += PLAYLIST_CONFIRM_MS + 500;
  taken.answer("asked");
  assert.deepEqual(taken.log, ["load"], "Spotify is loading the playlist: play is not pressed over it");
});

test("the gate alone: sends at once without a load, holds with one, releases in order, expires", () => {
  const out: string[] = [];
  const g = createLoadGate((a) => void out.push(a), 100);
  g.send("play");
  g.hold(0);
  g.send("pause");
  g.send("next");
  g.expire(100);
  assert.deepEqual(out, ["play"]);
  g.expire(101);
  assert.deepEqual(out, ["play", "pause", "next"]);
  g.send("play");
  assert.deepEqual(out, ["play", "pause", "next", "play"]);
});

test("playlistAtStart asks only while the clock is ready: a paused or running clock at position 0 loads nothing", () => {
  const opened = openText(INITIAL, "class.json", WITH, classSchema, 1000, true, true);
  assert.notEqual(playlistAtStart(opened, { type: "start" }, 1000, true, true).ask, null, "ready at zero: asked");
  const l = opened.loaded;
  assert.ok(l);
  for (const status of ["running", "paused"] as const) {
    const s: typeof opened = { ...opened, loaded: { ...l, clock: { ...l.clock, status } } };
    assert.equal(playlistAtStart(s, { type: "start" }, 1000, true, true).ask, null, status);
  }
});
