// The plain level through the room join (#717, scene.md "Quality levels", S10): the join feeds every drawn frame to the quality
// monitor, steps the scene down, and at Plain shows the plain screen in one cut for the rest of the class. A fake clock and
// frames pumped by hand: no timers, no browser, nothing that depends on real time.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import type { JoinFrame } from "../join/room-feed-calc.ts";
import { startJoin } from "../join/scene-join.ts";
import type { JoinPorts, SceneHandle } from "../join/scene-join.ts";
import type { QualityLevel, SecondRow } from "../../model/src/index.ts";

const doc = (title: string): Class => ({
  class: { title, sport: "cycling", length_ms: 120_000 },
  music: { source: "spotify", design_crossfade_ms: 0, song_timing: "measured" },
  zone_scale: [{ zone: 1, name: "Easy", rpe: [1, 2] }],
  intervals: [{ start_ms: 0, length_ms: 120_000, zone: 1, cue: "Spin.", cadence: "beat" }],
  songs: [{ title: "A", artist: "B", length_ms: 120_000, start_ms: 0, end_ms: 120_000, bpm: 120, beat_anchors: { quality: "measured", anchors: [{ at_ms: 0, bpm: 120 }] } }],
}) as unknown as Class;
const frame = (title = "Fake ride", status: "ready" | "running" | "ended" = "running"): JoinFrame => ({
  doc: doc(title), playlistNotLoaded: false, mix: null, view: { status, classMs: 10_000, songIndex: null },
  link: { mode: "following", state: "Locked", held: false, songIndex: null, announcement: null, available: true },
});

/** The join with ports whose animation frames are pumped by hand at chosen times. */
function room(opts: { onSecond?: (row: SecondRow) => void; throwOnSecond?: boolean } = {}) {
  let t = 0;
  let next: ((n: number) => void) | null = null;
  const shown: string[] = [];
  const quality: QualityLevel[] = [];
  let created = 0;
  let disposed = 0;
  const ports: JoinPorts = {
    now: () => t,
    schedule: (cb) => { next = cb; return () => { if (next === cb) next = null; }; },
    later: () => () => undefined, // the watchdog never fires: the frames are the test's
    create: () => {
      created++;
      const handle: SceneHandle = { frame: () => undefined, setQuality: (l) => { quality.push(l); }, dispose: () => { disposed++; } };
      return handle;
    },
    show: (m) => { shown.push(m); },
    visible: () => true,
  };
  const join = startJoin(ports, { reducedMotion: false, onSecond: opts.throwOnSecond ? () => { throw new Error("log"); } : opts.onSecond });
  /** One frame at `ms` on the fake clock. */
  const at = (ms: number): void => { t = ms; const run = next; next = null; run?.(ms); };
  /** Frames every `gapMs` from `from` for `seconds`, the first at `from` itself; returns the time of the last frame. */
  const pump = (from: number, gapMs: number, seconds: number): number => {
    const n = Math.round((seconds * 1000) / gapMs);
    for (let i = 0; i <= n; i++) at(from + i * gapMs);
    return from + n * gapMs;
  };
  return { join, at, pump, shown, quality, created: () => created, disposed: () => disposed };
}

const FPS25 = 40;

test("25 fps walks High, Medium, Low, Plain, 5 s a step: the room is plain after 15 s and not before", () => {
  const r = room();
  r.join.push(frame());
  r.pump(0, FPS25, 14.9);
  assert.equal(r.join.mode, "scene", "25 fps for 4.9 s at Low does not switch");
  assert.deepEqual(r.quality, ["Medium", "Low"]);
  r.pump(14.9 * 1000 + FPS25, FPS25, 0.2);
  assert.equal(r.join.mode, "plain");
  assert.equal(r.join.why, "too slow");
  assert.deepEqual(r.shown, ["scene", "plain"], "one cut: the scene, then the plain screen, nothing between");
  assert.equal(r.disposed(), 1);
});

test("25 fps at Low for 5 s is what switches: the step into Low is at 10 s, the switch at 15 s", () => {
  const r = room();
  r.join.push(frame());
  r.pump(0, FPS25, 10);
  assert.deepEqual(r.quality, ["Medium", "Low"]);
  assert.equal(r.join.mode, "scene");
  r.pump(10_040, FPS25, 5);
  assert.equal(r.join.mode, "plain");
});

test("30 fps or more never reaches Plain, however long the class: 30 fps settles at Low, 60 fps stays at High", () => {
  for (const [fps, steps] of [[30, ["Medium", "Low"]], [60, []]] as const) {
    const r = room();
    r.join.push(frame());
    for (let i = 0; i <= fps * 120; i++) r.at(Math.round((i * 1000) / fps));
    assert.equal(r.join.mode, "scene", `${fps} fps`);
    assert.deepEqual(r.quality, steps, `${fps} fps`);
    assert.equal(r.disposed(), 0);
  }
});

test("Plain lasts to the end of the class: more frames, the end, and a pushed ready frame bring the scene back only for another class", () => {
  const r = room();
  r.join.push(frame());
  const last = r.pump(0, FPS25, 15.2);
  assert.equal(r.join.mode, "plain");
  r.join.push(frame("Fake ride", "running"));
  r.at(last + 100);
  r.join.push(frame("Fake ride", "ended"));
  r.at(last + 200);
  assert.equal(r.join.mode, "plain");
  assert.equal(r.created(), 1, "the scene was not built again in the same class");
  r.join.push(frame("Fake ride", "ready"));
  assert.equal(r.created(), 1, "a restart of the same class (ready again) does not bring the scene back: Plain is for the rest of that class");
  r.join.push(frame("Another ride"));
  assert.equal(r.created(), 2, "the next class gets its scene");
  r.at(last + 1000);
  assert.equal(r.join.mode, "scene");
});

test("the second's log row comes through the join, at the level it was drawn at, and a failing log kills nothing", () => {
  const rows: SecondRow[] = [];
  const r = room({ onSecond: (row) => rows.push(row) });
  r.join.push(frame());
  r.pump(0, FPS25, 6.5);
  assert.ok(rows.length >= 6);
  assert.ok(rows.slice(0, 5).every((x) => x.level === "High" && Math.abs(x.fps - 25) < 0.5));
  assert.equal(rows[5]!.level, "Medium");
  const bad = room({ throwOnSecond: true });
  bad.join.push(frame());
  bad.pump(0, FPS25, 3);
  assert.equal(bad.join.mode, "scene");
});

test("two long gaps in a row through the join do not step the scene (each gap counts at most 2 s)", () => {
  const r = room();
  r.join.push(frame());
  r.at(0);
  r.at(10_000);
  r.at(20_000);
  assert.deepEqual(r.quality, []);
  assert.equal(r.join.mode, "scene");
  r.at(30_000);
  r.at(40_000);
  assert.deepEqual(r.quality, ["Medium"], "capped at 2 s each, the fourth gap's total reaches 5 s");
});

test("the still rig never gives way for a slow machine", () => {
  let t = 0;
  const box: { next: ((n: number) => void) | null } = { next: null };
  const shown: string[] = [];
  const ports: JoinPorts = {
    now: () => t, schedule: (cb) => { box.next = cb; return () => undefined; }, later: () => () => undefined,
    create: () => ({ frame: () => undefined, dispose: () => undefined }), show: (m) => { shown.push(m); }, visible: () => true,
  };
  const join = startJoin(ports, { reducedMotion: true, stillRig: true });
  join.push(frame());
  for (let i = 0; i <= 700; i++) { t = i * FPS25; const run = box.next; box.next = null; run?.(t); }
  assert.equal(join.mode, "scene");
  assert.deepEqual(shown, ["scene"]);
});
