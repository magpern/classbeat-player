// Scope item 2, rule 4 on the drawn directions: two classes that differ only in their intervals
// give identical drawn directions on every frame, not only identical targets. Both classes are fed
// the same sequence of motion phases and frame times (the phase's rate comes from the zone, so a
// time-driven run would differ, and the zone is not taken out of the rate to make it pass).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Direction } from "../src/beams.ts";
import { sceneFrame } from "../src/frame.ts";
import { START_STATE, stepRig, turnToward } from "../src/step.ts";
import type { RigState } from "../src/step.ts";
import { classA, classB, classSameZones } from "./fixtures.ts";

const link = { state: "Locked" as const };
// A frame-time sequence with stalls, a song position that crosses a phrase flip, a song change
// from a mirrored phrase and a build with its drop, and a phase sequence that jumps as well as runs.
const DTS = Array.from({ length: 4000 }, (_, i) => (i % 411 === 410 ? 0.25 : i % 997 === 996 ? 1 : i % 3 === 0 ? 1 / 144 : 1 / 60));
const SONG_POS: readonly [number, number][] = [[0, 0], [0, 15_000], [0, 18_000], [1, 0], [1, 5_000], [0, 35_000], [0, 41_000], [2, 12_000]];

test("rule 4: classes that differ only in their intervals draw every beam the same way on every frame", () => {
  let a: readonly Direction[] | null = null;
  let b: readonly Direction[] | null = null;
  let phase = 0;
  let changed = 0;
  DTS.forEach((dt, n) => {
    phase = n % 600 === 599 ? (phase + 200) % 360 : (phase + 30 * Math.min(dt, 0.1)) % 360;
    const [songIndex, base] = SONG_POS[Math.floor(n / 500) % SONG_POS.length]!;
    const songPosMs = base + (n % 500) * 16;
    const fa = sceneFrame({ cls: classA, classMs: songPosMs, songIndex, songPosMs, phaseDeg: phase, link });
    const fb = sceneFrame({ cls: classB, classMs: 250_000 - songPosMs, songIndex, songPosMs, phaseDeg: phase, link });
    assert.deepEqual(fa.directions, fb.directions, `targets, frame ${n}`);
    const [nextA, nextB] = [turnToward(a, fa.directions, dt, false), turnToward(b, fb.directions, dt, false)];
    assert.deepEqual(nextA, nextB, `drawn, frame ${n}`);
    if (a && nextA.some((d, i) => d.pan !== a![i]!.pan)) changed++;
    [a, b] = [nextA, nextB];
  });
  assert.ok(changed > 1000, "the beams really moved");
});

test("rule 4 through the renderer's own step: same zones, every other interval field different, same drawn directions", () => {
  let [sa, sb]: [RigState, RigState] = [START_STATE, START_STATE];
  for (let n = 0; n < 3000; n++) {
    const posMs = n * 40;
    const input = { classMs: posMs, songIndex: Math.floor(n / 700) % 3, songPosMs: posMs % 50_000, link, rawDtSeconds: DTS[n]! };
    const ra = stepRig(sa, { cls: classA, ...input });
    const rb = stepRig(sb, { cls: classSameZones, ...input });
    assert.deepEqual(ra.drawn, rb.drawn, `frame ${n}`);
    [sa, sb] = [ra.state, rb.state];
  }
});

test("the limiter's own inputs are the drawn direction, the target and the step: nothing else", () => {
  assert.equal(turnToward.length, 4); // previous drawn, targets, frame time, frozen
  assert.equal(stepRig.length, 2);
});
