// The flash budget's beat-like light numbers (scene.md "The flash budget"): the shape every rise and fall shares, the
// 5 % cap each run stays under, the build's window and the haze's gain.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCENT, BUILD_LIFT, BUILD_HAZE_STEP, LENS_FLASH, LIFT_CAP, TEMPO_PULSE, buildHaze, lensShape, liftShape, riseFall } from "../src/flash-budget.ts";
import { MAX_BEAT_LIFT, ZONES, energyFor } from "../src/energy.ts";
import { buildElapsedMs } from "../src/moments.ts";

test("a lift rises in 40 ms, falls in 200 ms and is at rest after; the lens flash rises in 40 ms and falls in 120 ms", () => {
  assert.deepEqual([-1, 0, 20, 40, 140, 240, 500].map(liftShape), [0, 0, 0.5, 1, 0.5, 0, 0]);
  assert.deepEqual([0, 20, 40, 100, 160, 161].map(lensShape), [0, 0.5, 1, 0.5, 0, 0]);
  assert.equal(riseFall(Number.NaN, 40, 200), 0);
});

test("no run of beat-like light alone passes the 5 % cap: a lift of 4.5 %, the 5 % accent, a build's 2 % lift with the haze's 3 % step", () => {
  for (const z of ZONES) assert.ok(energyFor(z).beatLift / (1 + energyFor(z).beatLift) < LIFT_CAP);
  assert.equal(MAX_BEAT_LIFT, 0.045);
  assert.ok(ACCENT / (1 + ACCENT) < LIFT_CAP && TEMPO_PULSE / (1 + TEMPO_PULSE) < LIFT_CAP);
  const build = (1 + BUILD_LIFT) * (1 + BUILD_HAZE_STEP);
  assert.ok((build - 1) / build <= LIFT_CAP, `a build's rise is ${(build - 1) / build}`);
  assert.equal(LENS_FLASH, 0.25);
});

test("the build lasts 8 beats before a drop, or from a build moment; null outside it", () => {
  const items = [{ at_ms: 40_000, kind: "drop" as const }, { at_ms: 80_000, kind: "build" as const }];
  assert.equal(buildElapsedMs(items, 120, 35_999), null);
  assert.equal(buildElapsedMs(items, 120, 36_000), 0);
  assert.equal(buildElapsedMs(items, 120, 39_000), 3000);
  assert.equal(buildElapsedMs(items, 120, 40_000), null, "the drop ends the build");
  assert.equal(buildElapsedMs(items, 120, 81_000), 1000);
  assert.equal(buildElapsedMs(items, undefined, 39_000), null, "no bpm: no window is known");
  assert.equal(buildElapsedMs(undefined, 120, 39_000), null);
});

test("the haze's gain is 1 before the build, steps with the beat, and rises at most 3 % a second where the beat is not known", () => {
  assert.equal(buildHaze(-5, 500), 1);
  assert.ok(buildHaze(4000, 500) > buildHaze(3000, 500));
  assert.equal(buildHaze(2000, null), 1.06);
});
