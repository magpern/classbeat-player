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

test("a one-frame jump is a scheduled step, taken out; the drift after it is still read", () => {
  const stepped = signal(3000, (t) => (t < 1000 ? 0.1 : 0.2));
  assert.equal(withoutSteps(stepped.y).steps, 1);
  assert.ok(rate(stepped).worst < 1e-9, "a step alone moves nothing");
  const drifting = signal(3000, (t) => (t < 1000 ? 0.1 : 0.2) + 0.00003 * t);
  assert.ok(rate(drifting).worst > 0.1 && rate(drifting).steps === 1, "a drift of 0.03 a second over the step's 0.2 is read");
});

test("a slow ramp over several frames is not mistaken for a step", () => {
  assert.equal(withoutSteps(signal(1000, (t) => 0.1 + 0.05 * (t / 1000)).y).steps, 0);
});
