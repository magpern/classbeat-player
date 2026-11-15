// Scope item 2, unit: for any drawn direction and target, and frame times from 4 ms to 100 ms,
// one step turns by at most 30 degrees times the frame time (plus 0.01 degrees of rounding), never
// overshoots, reaches the target in the fewest steps, and does nothing when already there.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Direction } from "../src/beams.ts";
import { MAX_DEG_PER_SECOND } from "../src/energy.ts";
import { MAX_FRAME_SECONDS, clampFrameTime } from "../src/step.ts";
import { angleBetween, limitTurn } from "../src/turn.ts";

const ROUNDING = 0.01;
const FRAME_TIMES = [0.004, 0.005, 1 / 144, 0.01, 1 / 60, 0.02, 1 / 30, 0.05, 0.075, 0.1];

// A small deterministic generator: the tests never use randomness from the clock.
function lcg(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}
function sampleDirections(n: number): Direction[] {
  const r = lcg(7);
  return Array.from({ length: n }, () => ({ pan: (r() * 2 - 1) * 180, tilt: (r() * 2 - 1) * 90 }));
}
const pairs = sampleDirections(120).map((d, i, all) => [d, all[(i * 7 + 3) % all.length]!] as const);

test("angleBetween is the real angle between two directions", () => {
  assert.ok(Math.abs(angleBetween({ pan: 0, tilt: 0 }, { pan: 90, tilt: 0 }) - 90) < 1e-9);
  assert.ok(Math.abs(angleBetween({ pan: 0, tilt: 0 }, { pan: 0, tilt: 45 }) - 45) < 1e-9);
  assert.ok(Math.abs(angleBetween({ pan: 10, tilt: 0 }, { pan: 370, tilt: 0 })) < 1e-9); // pan wraps
  assert.ok(angleBetween({ pan: 0, tilt: 80 }, { pan: 90, tilt: 80 }) < 20); // near the pole a pan step is short
});

test("one step turns at most 30 degrees a second times the frame time, and never overshoots", () => {
  for (const dt of FRAME_TIMES) {
    const maxDeg = MAX_DEG_PER_SECOND * dt;
    for (const [drawn, target] of pairs) {
      const next = limitTurn(drawn, target, maxDeg);
      const moved = angleBetween(drawn, next);
      assert.ok(moved <= maxDeg + ROUNDING, `moved ${moved} > ${maxDeg} at ${dt}`);
      assert.ok(angleBetween(next, target) <= angleBetween(drawn, target) + 1e-9, "never moves away");
      // It moves exactly as far as it may, along the shortest turn, or arrives.
      const left = angleBetween(drawn, target);
      assert.ok(Math.abs(moved - Math.min(left, maxDeg)) < ROUNDING, `moved ${moved}, expected ${Math.min(left, maxDeg)}`);
      assert.ok(Math.abs(angleBetween(next, target) - Math.max(0, left - maxDeg)) < ROUNDING);
    }
  }
});

test("it reaches the target in the fewest steps and then stays", () => {
  for (const dt of FRAME_TIMES) {
    const maxDeg = MAX_DEG_PER_SECOND * dt;
    for (const [from, target] of pairs.slice(0, 30)) {
      let drawn = from;
      const fewest = Math.ceil(angleBetween(from, target) / maxDeg - 1e-6);
      let steps = 0;
      while (angleBetween(drawn, target) > 0 && steps < 10_000) {
        drawn = limitTurn(drawn, target, maxDeg);
        steps++;
      }
      assert.ok(steps <= fewest + 1, `${steps} steps, fewest ${fewest}`);
      assert.deepEqual(drawn, target, "arrives exactly on the target");
      assert.deepEqual(limitTurn(drawn, target, maxDeg), target);
    }
  }
});

test("it does nothing when already there, and nothing for a step that is not positive", () => {
  const d = { pan: 12.5, tilt: -30 };
  assert.equal(limitTurn(d, d, 3), d);
  assert.equal(limitTurn(d, { pan: 50, tilt: 0 }, 0), d);
  assert.equal(limitTurn(d, { pan: 50, tilt: 0 }, -1), d);
  assert.equal(limitTurn(d, { pan: 50, tilt: 0 }, Number.NaN), d);
});

test("it takes the shortest turn, also across the 180 degree pan seam, and straight back still turns", () => {
  const next = limitTurn({ pan: 170, tilt: 0 }, { pan: -170, tilt: 0 }, 5);
  assert.ok(Math.abs(Math.abs(next.pan) - 175) < 1e-9 && next.pan > 0, `went the long way: ${next.pan}`);
  const back = limitTurn({ pan: 0, tilt: 0 }, { pan: 180, tilt: 0 }, 5);
  assert.ok(Math.abs(angleBetween({ pan: 0, tilt: 0 }, back) - 5) < ROUNDING);
});

test("the frame time is clamped to 100 ms, so a stalled frame turns a beam by at most 3 degrees", () => {
  assert.equal(MAX_FRAME_SECONDS, 0.1);
  for (const [raw, used] of [[0.004, 0.004], [0.1, 0.1], [0.25, 0.1], [1, 0.1], [60, 0.1], [0, 0], [-1, 0], [Number.NaN, 0]] as const) {
    assert.equal(clampFrameTime(raw), used);
  }
  assert.ok(MAX_DEG_PER_SECOND * clampFrameTime(1) <= 3 + 1e-9);
});
