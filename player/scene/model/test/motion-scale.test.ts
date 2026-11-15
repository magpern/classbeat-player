// Halved movement off the list and before the start (scene.md "States", S7): the motion phase's rate is the
// zone's row times a scale of 0 to 1, never above the row and never more than 30 degrees a second; the scale
// depends on nothing of the interval (rule 4). `noMusic` computes the frame as with no link, and still moves.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_DEG_PER_SECOND } from "../src/energy.ts";
import { advancePhase, phaseRate } from "../src/phase.ts";
import { START_STATE, stepRig } from "../src/step.ts";
import { classA, classSameZones } from "./fixtures.ts";

const base = { cls: classA, classMs: 70_000, songIndex: 0, songPosMs: 20_000, rawDtSeconds: 1 / 60 } as const;
const locked = { state: "Locked" as const };

test("the phase advances at the zone's row times the scale, never faster than the row, never above 30 degrees a second", () => {
  for (const zone of [1, 2, 3, 4, 5, 6, 7]) {
    assert.equal(advancePhase(0, 1, zone, 0.5), phaseRate(zone) * 0.5);
    assert.equal(advancePhase(0, 1, zone), phaseRate(zone));
    assert.equal(advancePhase(0, 1, zone, 7), phaseRate(zone), "a scale above 1 is 1");
    assert.equal(advancePhase(0, 1, zone, -1), 0, "a negative scale holds it");
    assert.equal(advancePhase(0, 1, zone, Number.NaN), phaseRate(zone), "not a number is no scale");
    assert.ok(advancePhase(0, 1, zone, 1) <= MAX_DEG_PER_SECOND);
  }
});

test("a step with motion 0.5 turns the phase half as far as a step without, and the scale is the whole of the difference", () => {
  const [full, half] = [stepRig(START_STATE, { ...base, link: locked }), stepRig(START_STATE, { ...base, link: locked, motion: 0.5 })];
  assert.equal(half.state.phaseDeg, full.state.phaseDeg / 2);
  assert.equal(stepRig(START_STATE, { ...base, link: locked, motion: 1 }).state.phaseDeg, full.state.phaseDeg);
});

test("rule 4: the scale takes no interval: two classes that differ only in their intervals give the same directions at the same scale", () => {
  const input = { ...base, link: locked, motion: 0.5 } as const;
  let [a, b] = [stepRig(START_STATE, input), stepRig(START_STATE, { ...input, cls: classSameZones })];
  for (let i = 0; i < 300; i++) [a, b] = [stepRig(a.state, input), stepRig(b.state, { ...input, cls: classSameZones })];
  assert.deepEqual(a.drawn, b.drawn);
  assert.equal(a.state.phaseDeg, b.state.phaseDeg);
});

test("noMusic: the frame has no beat level and no moments, and the phase still advances (before the start)", () => {
  const s = stepRig(START_STATE, { ...base, link: locked, songPosMs: 38_000, noMusic: true });
  assert.equal(s.frame.level, "None");
  assert.deepEqual(s.frame.moments, { gather: false, fan: false, breakdown: false });
  assert.ok(s.state.phaseDeg > 0, "unlike the still rig");
});
