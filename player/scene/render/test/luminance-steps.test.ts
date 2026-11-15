// The S6 counter (tools/luminance-steps.ts) on made-up signals: it counts every change over 10 % in each
// direction, with no duration gate and no pairing, and it can fail. The browser run measures the real frames.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FLOOR, MAX_CHANGES_PER_SECOND, findChanges, mostInASecond } from "../tools/luminance-steps.ts";

const FRAME_MS = 1000 / 60;
const signal = (ms: number, f: (t: number) => number) => { const t = Array.from({ length: Math.round(ms / FRAME_MS) }, (_, i) => i * FRAME_MS); return { t, y: t.map(f) }; };
const changes = (s: { t: number[]; y: number[] }) => findChanges(s.t, s.y);

test("steady, a wobble under 10 % and black have no changes; a ramp over 10 % is one change, however slow", () => {
  assert.equal(changes(signal(2000, () => 0.1)).length, 0);
  assert.equal(changes(signal(2000, (t) => 0.1 + 0.004 * Math.sin(t / 400))).length, 0);
  assert.equal(changes(signal(1000, () => FLOOR / 4)).length, 0);
  assert.equal(changes(signal(2000, (t) => 0.1 + 0.05 * Math.min(1, t / 700))).length, 1, "a 700 ms ramp of 50 %");
  assert.equal(changes(signal(2000, (t) => 0.1 + 0.05 * Math.min(1, t / 200))).length, 1);
  assert.equal(changes(signal(2000, (t) => 0.1 + 0.05 * Math.min(1, t / 1900))).length, 1, "and one over 1.9 s");
});

test("each direction counts: a flash that rises and falls is two changes, a lift and its fall back are two", () => {
  const burst = (t: number) => 0.05 + (t >= 500 && t < 750 ? 0.85 * (1 - (t - 500) / 250) : 0);
  const s = changes(signal(1500, burst));
  assert.deepEqual(s.map((x) => x.rising), [true, false]);
  const lift = (t: number) => 0.1 * (1 + 0.6 * (1 - (t % 500) / 500) ** 3);
  assert.equal(mostInASecond(changes(signal(3000, lift))) >= 3, true, "a beat lift at 120 bpm is 4 changes in 1 s, not 2");
});

test("the combined song and interval change (burst on the lit room, its decay to the dimmed room, the end of the dim) is three changes in half a second", () => {
  const level = (t: number) => (t < 500 ? 0.2 : t < 968 ? 0.05 + (t < 750 ? 0.85 * (1 - (t - 500) / 250) : 0) : 0.2);
  const s = changes(signal(2000, level));
  assert.deepEqual(s.map((x) => x.rising), [true, false, true]);
  assert.equal(mostInASecond(s), MAX_CHANGES_PER_SECOND);
});

test("the check can fail: a 3 Hz on and off flicker is six changes a second, and a fourth change in the combined case is seen", () => {
  assert.equal(mostInASecond(changes(signal(2000, (t) => (Math.floor(t / (1000 / 6)) % 2 === 0 ? 0.1 : 0.3)))) > MAX_CHANGES_PER_SECOND, true);
  const level = (t: number) => (t < 500 ? 0.2 : t < 968 ? 0.05 + (t < 750 ? 0.85 * (1 - (t - 500) / 250) : 0) : 0.2) + (t >= 1100 && t < 1180 ? 0.4 : 0);
  assert.ok(mostInASecond(changes(signal(2500, level))) > MAX_CHANGES_PER_SECOND);
});
