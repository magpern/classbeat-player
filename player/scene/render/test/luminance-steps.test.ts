// The S6 counter (tools/luminance-steps.ts) on made-up signals: it counts what it should, ignores what it
// should, and can fail (a fourth step in a second is seen). The browser run measures the real frames.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FLOOR, MAX_STEPS_PER_SECOND, findSteps, mostInASecond } from "../tools/luminance-steps.ts";

const FRAME_MS = 1000 / 60;
const times = (n: number) => Array.from({ length: n }, (_, i) => i * FRAME_MS);
/** A luminance per frame from a function of the time in ms. */
const signal = (ms: number, f: (t: number) => number) => { const t = times(Math.round(ms / FRAME_MS)); return { t, y: t.map(f) }; };
const steps = (s: { t: number[]; y: number[] }) => findSteps(s.t, s.y);

test("a steady scene, a drift and a slow ramp, however large, have no steps; a ramp over 10 % in under 300 ms is one", () => {
  assert.equal(steps(signal(2000, () => 0.1)).length, 0);
  assert.equal(steps(signal(2000, (t) => 0.1 + 0.004 * Math.sin(t / 400))).length, 0, "a wobble of 4 %");
  assert.equal(steps(signal(2000, (t) => 0.1 + 0.05 * Math.min(1, t / 700))).length, 0, "a 700 ms ramp of 50 % is a change of look: the colour cross");
  assert.equal(steps(signal(2000, (t) => 0.1 + 0.05 * Math.min(1, t / 200))).length, 1, "the same ramp in 200 ms is a flash");
  assert.equal(steps(signal(1000, () => FLOOR / 4)).length, 0, "black is not a signal");
});

test("a beat lift and its fall back are one step, not two", () => {
  const lift = (t: number) => { const p = (t % 500) / 500; return 0.1 * (1 + 0.6 * (1 - p) ** 3); };
  const s = steps(signal(3000, lift));
  assert.ok(s.length >= 5 && s.length <= 6, `${s.length} steps in 6 beats`);
  assert.ok(s.slice(0, -1).every((x) => x.returns), "each is a lift and its fall back (or the fall and the next lift): one step");
  assert.ok(mostInASecond(s) <= 2, "two beats a second");
});

test("a drop burst on a room that stays as it was is one step: the flash and its fall back; so is a song change's dim for one beat and its end", () => {
  const burst = (t: number) => 0.05 + (t >= 500 && t < 750 ? 0.85 * (1 - (t - 500) / 250) : 0);
  const s = steps(signal(1500, burst));
  assert.deepEqual(s.map((x) => [x.rising, x.returns]), [[true, true]]);
  assert.equal(mostInASecond(s), 1);
  const dim = steps(signal(2000, (t) => (t >= 500 && t < 968 ? 0.05 : 0.2)));
  assert.deepEqual(dim.map((x) => [x.rising, x.returns]), [[false, true]]);
});

test("the combined song and interval change (burst on the lit room, its decay to the dimmed room, the end of the dim) is three steps in about half a second: the limit, not over it", () => {
  // The rig is dimmed to a quarter for one beat (468 ms at 128 bpm) as the burst starts on the same frame, and the dim ends.
  const level = (t: number) => (t < 500 ? 0.2 : t < 968 ? 0.05 + (t < 750 ? 0.85 * (1 - (t - 500) / 250) : 0) : 0.2);
  const s = steps(signal(2000, level));
  assert.deepEqual(s.map((x) => x.rising), [true, false, true]);
  assert.ok(s.at(-1)!.atMs - s[0]!.atMs < 500 + FRAME_MS);
  assert.equal(mostInASecond(s), MAX_STEPS_PER_SECOND);
});

test("the check can fail: a flash added to the combined case is a fourth step in that second", () => {
  const level = (t: number) => (t < 500 ? 0.2 : t < 968 ? 0.05 + (t < 750 ? 0.85 * (1 - (t - 500) / 250) : 0) : 0.2) * (t >= 1100 && t < 1180 ? 3 : 1) + (t >= 800 && t < 880 ? 0.4 : 0);
  assert.ok(mostInASecond(steps(signal(2500, level))) > MAX_STEPS_PER_SECOND);
});
