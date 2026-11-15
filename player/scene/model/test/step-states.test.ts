// "How a beam turns", items 4 and 7: nothing turns in the first frame (the beams start on their
// targets) and nothing turns while the rig is frozen; reduced motion holds the phase and the look.
import assert from "node:assert/strict";
import { test } from "node:test";
import { phaseRate } from "../src/phase.ts";
import { START_STATE, stepRig } from "../src/step.ts";
import { classA } from "./fixtures.ts";

const base = { cls: classA, classMs: 70_000, songIndex: 0, songPosMs: 20_000, rawDtSeconds: 1 / 60 } as const;
const locked = { state: "Locked" as const };

test("the first frame starts every beam on its target, whatever the frame time", () => {
  const s = stepRig(START_STATE, { ...base, link: locked, rawDtSeconds: 1 });
  assert.deepEqual(s.drawn, s.frame.directions);
  assert.equal(s.dtSeconds, 0.1);
});

test("the phase runs at the zone's rate with the clamped frame time", () => {
  const s = stepRig(START_STATE, { ...base, link: locked, rawDtSeconds: 1 });
  assert.equal(s.state.phaseDeg, phaseRate(4) * 0.1); // classMs 70 s is in the zone 4 interval
});

test("paused and held freeze the phase and the beams where they were", () => {
  const first = stepRig(START_STATE, { ...base, link: locked });
  for (const link of [{ state: "Paused" as const }, { state: "Locked" as const, held: true }]) {
    const next = stepRig(first.state, { ...base, link, songPosMs: 45_000, rawDtSeconds: 0.05 });
    assert.deepEqual(next.drawn, first.drawn);
    assert.equal(next.state.phaseDeg, first.state.phaseDeg);
  }
});

test("the still rig (reduced motion): the phase never advances, no moments, no phrase; a new look is turned to at the limit", () => {
  let s = stepRig(START_STATE, { ...base, link: locked, still: true });
  for (let i = 0; i < 100; i++) s = stepRig(s.state, { ...base, link: locked, still: true, songPosMs: 38_000 + i * 20 });
  assert.equal(s.state.phaseDeg, 0);
  assert.deepEqual(s.frame.moments, { gather: false, fan: false, breakdown: false });
  assert.equal(s.frame.phrase.mirrored, false);
  assert.deepEqual(s.drawn, s.frame.directions); // nothing is moving: it is the same still picture
  const changed = stepRig(s.state, { ...base, link: locked, still: true, songIndex: 1 });
  assert.notDeepEqual(changed.drawn, changed.frame.directions); // a new song turns, it does not jump
});
