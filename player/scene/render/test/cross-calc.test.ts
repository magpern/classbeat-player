// The hue cross's timing (cross-calc.ts, scene.md "Colour: two hues, never a mix"): the span is the interval's own
// length at most 700 ms, fixed for the interval; the ramp is linear; a seek is gated; reduced motion has no cross.
import assert from "node:assert/strict";
import { test } from "node:test";
import { feedAt } from "../demo/scenario.ts";
import { CROSS_MS, CrossGate, NO_CROSS, crossLook, easeOut } from "../src/cross-calc.ts";
import { RigLoop } from "../src/loop.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

/** The look at each frame (60 fps) of an interval of `lengthMs` that was entered `lengthMs` before its end. */
const run = (lengthMs: number) => Array.from({ length: Math.ceil(lengthMs / (1000 / 60)) }, (_, i) => crossLook(lengthMs - i * (1000 / 60), i * (1000 / 60)));

test("a long interval gives the full 700 ms: the front enters at the right edge and leaves at the left, the ramp is linear", () => {
  const frames = run(20_000).filter((l) => l !== NO_CROSS);
  assert.ok(frames.length >= 41 && frames.length <= 43, `${frames.length} frames of 700 ms`);
  assert.ok(frames[0]!.ramp < 0.03 && frames[0]!.front > 0.9, "it starts at the right edge");
  assert.ok(frames.at(-1)!.ramp > 0.97 && frames.at(-1)!.front < 0.01, "it ends at the left edge, at the change");
  frames.slice(1).forEach((l, i) => assert.ok(Math.abs(l.ramp - frames[i]!.ramp - 1000 / 60 / CROSS_MS) < 1e-9, "linear"));
  frames.forEach((l) => assert.ok(Math.abs(l.front - (1 - easeOut(l.ramp))) < 1e-12));
});

test("a 500 ms interval: the cross starts at the previous change and runs the whole interval; the span is not recomputed as the interval goes on", () => {
  const frames = run(500);
  assert.ok(frames.every((l) => l !== NO_CROSS), "a cross on every frame, from the first");
  assert.ok(frames[0]!.ramp === 0 && frames[0]!.front === 1, "it starts at the previous change");
  assert.ok(frames.at(-1)!.ramp > 0.95, "and ends at the next");
  frames.slice(1).forEach((l, i) => assert.ok(Math.abs(l.ramp - frames[i]!.ramp - 1000 / 60 / 500) < 1e-9, "linear over 500 ms, one slope"));
  assert.deepEqual(crossLook(300, 200), { front: 1 - easeOut(0.4), ramp: 0.4 });
  assert.deepEqual(crossLook(100, 400), { front: 1 - easeOut(0.8), ramp: 0.8 });
});

test("no cross at the last interval, past the change, or before the window", () => {
  assert.equal(crossLook(null, 5000), NO_CROSS);
  assert.equal(crossLook(0, 5000), NO_CROSS);
  assert.equal(crossLook(701, 5000), NO_CROSS);
});

test("a seek into the window is gated until the window is over; reduced motion has no cross at all", () => {
  const gate = new CrossGate();
  const inside = crossLook(300, 10_000);
  assert.equal(gate.filter(1000, NO_CROSS), NO_CROSS);
  assert.equal(gate.filter(19_700, inside), NO_CROSS, "the clock jumped into the window: no cross");
  assert.equal(gate.filter(19_716, inside), NO_CROSS, "and none while that window lasts");
  assert.equal(gate.filter(20_100, NO_CROSS), NO_CROSS, "the window is over");
  assert.equal(gate.filter(39_000, NO_CROSS), NO_CROSS);
  assert.deepEqual(gate.filter(39_300, crossLook(700, 10_000)), crossLook(700, 10_000), "the next one runs");
  const tokens = tokensFromFile();
  const loop = new RigLoop(tokens);
  for (let ms = 35_000, n = 0; ms < 40_500; n++) {
    const d = loop.step(feedAt(ms, { reducedMotion: true }), n === 0 ? 0 : 1 / 60, "High");
    assert.deepEqual([d.cross.front, d.cross.ramp], [2, 0], `at ${ms}`);
    ms += d.dtSeconds * 1000;
  }
});
