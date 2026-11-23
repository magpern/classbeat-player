// The count of the shared 1 (tools/shared-one.ts) and the matrices' coverage (tools/shared-cases.ts): the count is the strict measure's, a burst's
// rise is a mark and is left out, and each gate can fail: a decay beside another change counts 2, a matrix with a hole names it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LOOKS } from "../../model/src/index.ts";
import { findChanges, frameTimes } from "../tools/luminance-steps.ts";
import { QUALITIES, STATES, TEMPOS, ZONE_ROWS, lookByZone, missing, phraseMs, phraseStartMs, specOf } from "../tools/shared-cases.ts";
import { SHARED_MAX, burstFrames, decayCount, mostAround, wholeRun } from "../tools/shared-one.ts";

const F = 1000 / 60;
const frames = (n: number): number[] => frameTimes(Array.from({ length: n }, (_, i) => i));
const at = (i: number): number => i * F;

/** A region at 0.5 with a burst at frame 30: up to 0.85 in one frame, decaying linearly to 0.5 over 15 frames (250 ms). */
function burstSeries(extra: (i: number) => number = () => 0): { wall: number[]; lum: number[]; burst: number[] } {
  const wall = frames(180);
  const burst = wall.map((_, i) => (i >= 30 && i < 45 ? 1 - (i - 30) / 15 : 0));
  const lum = wall.map((_, i) => 0.5 + 0.35 * burst[i]! + extra(i));
  return { wall, lum, burst };
}

test("a burst's decay counts 1 with its rise left out, and 2 with it in: the rise is a mark, the decay is the shared 1", () => {
  const { wall, lum, burst } = burstSeries();
  const changes = findChanges(wall, lum);
  assert.deepEqual(changes.map((c) => c.rising), [true, false], "the rise and the decay");
  const b = burstFrames(wall, burst)!;
  assert.ok(Math.abs(b.riseMs - at(30)) < 1e-6 && Math.abs(b.decay.fromMs - at(31)) < 1e-6 && Math.abs(b.decay.toMs - at(44)) < 1e-6);
  assert.equal(decayCount(b)(changes), SHARED_MAX);
  assert.equal(mostAround(changes, b.decay, null), 2, "the rise is counted when it is not left out");
});

test("the decay's gate can fail: another change inside the same second makes 2, one 1 s and more away does not count", () => {
  const near = burstSeries((i) => (i >= 60 ? 0.2 : 0)); // a step up of 0.2 half a second after the rise, inside the decay's second
  const b = burstFrames(near.wall, near.burst)!;
  assert.equal(decayCount(b)(findChanges(near.wall, near.lum)), 2, "the decay and a change beside it");
  const far = burstSeries((i) => (i >= 120 ? 0.2 : 0)); // 1.5 s after the rise: no 1 s window holds both
  assert.equal(decayCount(burstFrames(far.wall, far.burst)!)(findChanges(far.wall, far.lum)), 1);
  const sway = burstSeries((i) => (i >= 40 && i < 70 ? (i - 40) * 0.01 : i >= 70 ? 0.3 : 0)); // a slow rise over half a second, over 10 %, while the decay runs
  assert.ok(decayCount(burstFrames(sway.wall, sway.burst)!)(findChanges(sway.wall, sway.lum)) >= 2, "the sway drawn with the decay is counted with it");
});

test("a window that holds no frame of the decay is not its count, and a sliding second counts the sway and a sweep whole", () => {
  const { wall, burst } = burstSeries();
  const lum = wall.map((_, i) => 0.5 + 0.35 * burst[i]! + (i >= 100 ? 0.2 : 0) - (i >= 140 ? 0.2 : 0));
  const changes = findChanges(wall, lum);
  assert.equal(changes.length, 4, "rise, decay, and two steps (up, then down)");
  assert.equal(decayCount(burstFrames(wall, burst)!)(changes), 1, "the steps are 1.2 s and 1.8 s after the rise: outside the decay's second");
  assert.equal(wholeRun(changes), 2, "a sliding second over the whole run finds the two steps together");
  assert.equal(mostAround([], { fromMs: 0, toMs: 100 }), 0);
});

test("a slow ramp is one change once it passes 10 %, however slow, and none before: the gate's threshold, not a tolerance", () => {
  const ramp = (n: number) => frames(n).map((_, i) => 0.4 * (1 + (0.03 * i) / 60));
  assert.equal(findChanges(frames(150), ramp(150)).length, 0, "3 % a second over 2.5 s is 7.5 %: no change");
  assert.equal(findChanges(frames(240), ramp(240)).length, 1, "over 4 s it is 12 %: one change");
  assert.equal(wholeRun(findChanges(frames(240), ramp(240))), SHARED_MAX);
});

test("the matrices' coverage: 35 cases hold every look in every zone row, both parities, every tempo and quality level; a hole is named", () => {
  const cases = lookByZone();
  assert.equal(cases.length, 35);
  assert.deepEqual(missing(cases), []);
  for (const look of LOOKS) {
    const mine = cases.filter((c) => c.look === look);
    assert.deepEqual([...new Set(mine.map((c) => c.zone))].sort(), [...ZONE_ROWS], `${look} in every zone`);
    assert.deepEqual([...new Set(mine.map((c) => c.parity))].sort(), [0, 1], `${look} with both parities`);
    assert.deepEqual([...new Set(mine.map((c) => c.bpm))].sort((a, b) => a - b), [...TEMPOS], `${look} at every tempo`);
    assert.deepEqual([...new Set(mine.map((c) => c.quality))].sort(), [...QUALITIES].sort(), `${look} at every quality level`);
  }
  for (const zone of ZONE_ROWS) assert.deepEqual([...new Set(cases.filter((c) => c.zone === zone).map((c) => c.parity))].sort(), [0, 1], `zone ${zone} with both parities`);
  assert.ok(missing(cases.filter((c) => c.look !== "split")).includes("look split"));
  assert.ok(missing(cases.filter((c) => c.zone !== 7)).includes("zone 7"));
  assert.ok(missing(cases.filter((c) => c.parity !== 1)).includes("parity 1"));
  assert.ok(missing(cases.filter((c) => c.bpm !== 150)).includes("tempo 150"));
  assert.ok(missing(cases.filter((c) => c.quality !== "Low")).includes("quality Low"));
  assert.deepEqual(missing(cases, { states: STATES.map((s) => s.name) }), ["state locked", "state tempo only", "state coasting"], "a state with no case");
  assert.deepEqual(missing(cases.map((c) => ({ ...c, cause: "flip" })), { causes: ["flip", "gather"] }), ["cause gather"]);
});

test("a case starts in a phrase of its parity, never the first, and every tempo's phrase leaves 2.4 s at rest 4.5 s after the flip", () => {
  for (const f of lookByZone()) {
    const start = phraseStartMs(f);
    assert.equal(Math.floor(start / phraseMs(f.bpm)) % 2, f.parity);
    assert.ok(start >= 2 * phraseMs(f.bpm));
    assert.ok(phraseMs(f.bpm) >= 4500 + 2400, `${f.bpm} bpm: the stretch ends before the next flip`);
    assert.equal(specOf(f, false).songIndex, LOOKS.indexOf(f.look));
  }
});
