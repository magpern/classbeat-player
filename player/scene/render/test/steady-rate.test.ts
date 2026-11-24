// The steady-light counter (tools/steady-rate.ts) on made-up signals: it reads the most a region ranges in 1 s, takes out a one-frame
// scheduled step, and can fail. The browser run (tools/steady-run.ts) measures the real frames.
import assert from "node:assert/strict";
import { test } from "node:test";
import { STEADY_MAX, withoutSteps, worstRate } from "../tools/steady-rate.ts";

const FRAME_MS = 1000 / 60;
const signal = (ms: number, f: (t: number) => number) => { const t = Array.from({ length: Math.round(ms / FRAME_MS) }, (_, i) => i * FRAME_MS); return { t, y: t.map(f) }; };
const rate = (s: { t: number[]; y: number[] }) => worstRate(s.t, s.y);

test("a ramp of 3 % a second reads 3 %, a flat series and a wobble well under it read about nothing, a ramp of 6 % a second reads 6 %", () => {
  assert.ok(Math.abs(rate(signal(3000, (t) => 0.2 * (1 + (0.03 * t) / 1000))).worst - 0.03) < 0.002);
  assert.equal(rate(signal(2000, () => 0.1)).worst, 0);
  assert.ok(rate(signal(3000, (t) => 0.1 + 0.0005 * Math.sin(t / 300))).worst < 0.01);
  assert.ok(rate(signal(3000, (t) => 0.2 * (1 + (0.06 * t) / 1000))).worst > STEADY_MAX * 1.8, "the check can fail");
});

test("a move in 1 s is read whichever way it goes, and a slower move over several seconds is not", () => {
  assert.ok(rate(signal(3000, (t) => 0.2 - 0.04 * Math.min(1, Math.max(0, (t - 1000) / 1000)))).worst > 0.19, "a fall of 20 % in 1 s");
  assert.ok(rate(signal(8000, (t) => 0.2 - 0.04 * Math.min(1, Math.max(0, (t - 1000) / 7000)))).worst < 0.04, "the same fall over 7 s");
});

test("a one-frame jump on a marked frame is a scheduled step, taken out; the drift after it is still read", () => {
  const stepped = signal(3000, (t) => (t < 1000 ? 0.1 : 0.2));
  const marks = stepped.t.map((t) => t >= 1000 && t < 1000 + FRAME_MS ? "planned mark" : "");
  assert.equal(withoutSteps(stepped.y, marks).steps, 1);
  assert.ok(worstRate(stepped.t, stepped.y, [], marks).worst < 1e-9, "a step alone moves nothing");
  const drifting = signal(3000, (t) => (t < 1000 ? 0.1 : 0.2) + 0.00003 * t);
  const r = worstRate(drifting.t, drifting.y, [], drifting.t.map((t) => (t >= 1000 && t < 1000 + FRAME_MS ? "planned mark" : "")));
  assert.ok(r.worst > 0.1 && r.steps === 1, "a drift of 0.03 a second over the step's 0.2 is read");
});

test("a one-frame jump on a frame no mark names is not taken out and is reported", () => {
  const popped = signal(3000, (t) => (t < 1000 ? 0.1 : 0.2));
  const r = worstRate(popped.t, popped.y);
  assert.equal(r.steps, 0);
  assert.equal(r.unnamedAtMs.length, 1);
  assert.ok(r.worst > 0.4, "the jump stays in the series, so the rate fails too");
});

test("a slow ramp over several frames is not mistaken for a step", () => {
  assert.equal(withoutSteps(signal(1000, (t) => 0.1 + 0.05 * (t / 1000)).y).steps, 0);
});

test("a window that overlaps a sweep is not read, and a run that reads none says so", () => {
  const s = signal(2000, () => 0.1);
  assert.ok(worstRate(s.t, s.y).windows > 0);
  assert.equal(worstRate(s.t, s.y, s.t.map(() => true)).windows, 0);
});

test("the frames of a dark span and its two steps excuse a one-frame jump; the same jump on an unmarked frame outside a span still fails the gate", () => {
  const level = Array.from({ length: 40 }, (_, i) => (i < 10 ? 1 : i < 30 ? 0.4 : 1)); // a beam out at frame 10 and back at frame 30: two one-frame steps
  const span = level.map((_, i) => i >= 9 && i <= 31); // the dark span's frames, the frame of each step and the one after the step out
  assert.deepEqual(withoutSteps(level, [], span).unnamed, [], "inside a dark span: excused");
  assert.deepEqual(withoutSteps(level, [], level.map((_, i) => i >= 9 && i <= 20)).unnamed, [30], "the jump at frame 30 is outside any span: the gate names it and fails");
  assert.deepEqual(withoutSteps(level).unnamed, [10, 30], "with nothing marked both fail: the span's flag cannot hide a jump elsewhere");
});
