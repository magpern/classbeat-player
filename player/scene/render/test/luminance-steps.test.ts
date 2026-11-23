// The S6 counter (tools/luminance-steps.ts) on made-up signals: it counts every change over 10 % in each
// direction, with no duration gate and no pairing, and it can fail. The browser run measures the real frames.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FLOOR, MAX_CHANGES_PER_SECOND, findChanges, frameTimes, mostInASecond } from "../tools/luminance-steps.ts";

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

// A step of 20 % in the series on each listed frame index (a flip up or down each time), on a series of class times.
const steps = (classMs: number[], at: number[]): { t: number[]; y: number[] } => {
  let y = 0.2;
  const ys = classMs.map((_, i) => { if (at.includes(i)) y = y === 0.2 ? 0.3 : 0.2; return y; });
  return { t: frameTimes(classMs), y: ys };
};
const run = (fromMs: number, frames: number) => Array.from({ length: frames }, (_, i) => fromMs + i * FRAME_MS);
const straight = run(18_500, 180);

test("frame time is the class time in normal play: nothing else changes", () => {
  const out = frameTimes(straight);
  assert.ok(out.every((t, i) => Math.abs(t - straight[i]!) < 1e-6));
});

test("the gate can fail: 4 changes within 1 s of frame time are 4 on a steady clock", () => {
  const four = steps(straight, [10, 20, 30, 40]);
  assert.equal(mostInASecond(findChanges(four.t, four.y)), 4, "4 steps 167 ms apart");
});

test("the gate can fail across a backward seek: two changes before 20.5 s and two after the seek back to 19 s are 4 in a second", () => {
  // Frames 0 to 29 play 20.0 to 20.5 s, then the clock is 19.0 s again: steps at frames 10 and 20 before, 35 and 45 after (all within 0.6 s of frame time).
  const seek = [...run(20_000, 30), ...run(19_000, 60)];
  const s = steps(seek, [10, 20, 35, 45]);
  assert.equal(mostInASecond(findChanges(s.t, s.y)), 4, "by frame time");
  assert.ok(mostInASecond(findChanges(seek, s.y)) < 4, "by class time a seek back would hide some of them: the window must not do that");
});

test("the gate can fail across a forward jump: two changes before a 15 s jump and two after are 4 in a second", () => {
  const jump = [...run(71_000, 30), ...run(86_000, 60)];
  const s = steps(jump, [10, 20, 35, 45]);
  assert.equal(mostInASecond(findChanges(s.t, s.y)), 4, "a jump cannot spread changes apart");
  assert.equal(mostInASecond(findChanges(jump, s.y)), 2, "by class time the 15 s between them would hide them");
});

test("a seek's replayed changes are counted by frame time, not folded onto their first pass", () => {
  // Steps at 19.0 s (first pass) and at 19.0 s again after a seek back 1.5 s later: 1.5 s apart in frame time, so 1 in any second.
  const classMs = [...run(18_500, 90), ...run(19_000, 90)]; // 18.5 to 20.0 s, then 19.0 to 20.5 s
  const s = steps(classMs, [30, 90]);
  const wall = findChanges(s.t, s.y);
  assert.equal(wall.length, 2);
  assert.equal(mostInASecond(wall), 1, "by frame time they are 1.5 s apart");
  assert.equal(mostInASecond(findChanges(classMs, s.y)), 2, "by class time they would sit in the same second");
});
