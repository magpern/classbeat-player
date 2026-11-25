// The scene's frame-rate log (S9, #785): each sample the join reports reaches the player's log with its frame rate and level, and a
// failing write does not stop the scene. A fake join with its animation frames pumped by hand: no timers, no browser, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import type { JoinFrame } from "../../../scene/render/join/room-feed-calc.ts";
import { startJoin } from "../../../scene/render/join/scene-join.ts";
import type { JoinPorts, SceneHandle } from "../../../scene/render/join/scene-join.ts";
import { frameRateLogger, secondLine } from "../../src/renderer/room-scene-log.ts";

const doc = {
  class: { title: "Fake ride", sport: "cycling", length_ms: 120_000 },
  music: { source: "spotify", design_crossfade_ms: 0, song_timing: "measured" },
  zone_scale: [{ zone: 1, name: "Easy", rpe: [1, 2] }],
  intervals: [{ start_ms: 0, length_ms: 120_000, zone: 1, cue: "Spin.", cadence: "beat" }],
  songs: [{ title: "A", artist: "B", length_ms: 120_000, start_ms: 0, end_ms: 120_000, bpm: 120, beat_anchors: { quality: "measured", anchors: [{ at_ms: 0, bpm: 120 }] } }],
} as unknown as Class;
const frame: JoinFrame = {
  doc, playlistNotLoaded: false, mix: null, view: { status: "running", classMs: 10_000, songIndex: null },
  link: { mode: "following", state: "Locked", held: false, songIndex: null, announcement: null, available: true },
};

/** The join with the room window's `onSecond`, on a fake clock at 60 frames a second. */
function room(write: (line: string) => void) {
  let t = 0;
  let next: ((n: number) => void) | null = null;
  const ports: JoinPorts = {
    now: () => t,
    schedule: (cb) => { next = cb; return () => { if (next === cb) next = null; }; },
    later: () => () => undefined,
    create: () => ({ frame: () => undefined, setQuality: () => undefined, dispose: () => undefined }) satisfies SceneHandle,
    show: () => undefined,
    visible: () => true,
  };
  const join = startJoin(ports, { reducedMotion: false, onSecond: frameRateLogger(write) });
  join.push(frame);
  for (let i = 0; i <= 180; i++) { t = (i * 1000) / 60; const run = next as ((n: number) => void) | null; next = null; run?.(t); }
  return join;
}

test("each sample the join reports reaches the log with its frame rate and quality level", () => {
  const lines: string[] = [];
  room((l) => lines.push(l));
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((l) => /^scene frame rate: second=\d+ fps=\d+(\.\d+)? level=High$/.test(l)), lines.join("\n"));
  assert.ok(lines.every((l) => Math.abs(Number(/fps=([\d.]+)/.exec(l)![1]) - 60) < 1));
});

test("a log write that throws does not stop the scene", () => {
  let tries = 0;
  const join = room(() => { tries++; throw new Error("disk full"); });
  assert.ok(tries >= 2);
  assert.equal(join.mode, "scene");
});

test("the line holds the second, the rate and the level only", () => {
  assert.equal(secondLine({ second: 3, fps: 30, level: "Low" }), "scene frame rate: second=3 fps=30 level=Low");
});

test("the default writer is the console", () => {
  const seen: unknown[] = [];
  const orig = console.info;
  console.info = (...a: unknown[]) => { seen.push(...a); };
  try { frameRateLogger()({ second: 1, fps: 59, level: "High" }); } finally { console.info = orig; }
  assert.deepEqual(seen, ["scene frame rate: second=1 fps=59 level=High"]);
});
