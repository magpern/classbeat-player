// The sweeps' CI matrix (tools/shared-sweeps.ts): every cause in each state it exists in, every look, zone row, parity, tempo and quality level
// somewhere in it, the two-turn overlaps at every offset in steps of 250 ms, and each case's window really holds the turn it names.
import assert from "node:assert/strict";
import { test } from "node:test";
import { songSweeps } from "../../model/src/index.ts";
import { genName } from "../demo/generated.ts";
import { VARIANTS } from "../demo/scenario.ts";
import { STATES, missing } from "../tools/shared-cases.ts";
import { CAUSE_STATES, OVERLAP_STEP_MS, overlapCase, overlapOffsets, sweepCases } from "../tools/shared-sweeps.ts";

const cases = sweepCases();
const tagged = (list: typeof cases) => list.map((c) => ({ ...c.factors, state: c.state, cause: c.cause }));

test("every cause has a case in every state it exists in, and the union holds every look, zone row, parity, tempo and quality level", () => {
  const causes = Object.keys(CAUSE_STATES);
  assert.deepEqual(missing(tagged(cases), { causes, states: STATES.map((s) => s.name) }), [], "a hole in the matrix");
  for (const cause of causes) for (const state of CAUSE_STATES[cause as keyof typeof CAUSE_STATES]) assert.ok(cases.some((c) => c.cause === cause && c.state === state), `${cause} in ${state}`);
  assert.deepEqual(missing(tagged(cases.filter((c) => c.cause !== "seek")), { causes }), ["cause seek"], "a matrix without a cause names it");
});

test("the overlaps run at every offset in steps of 250 ms across the window, the flip first and the gather first", () => {
  const offsets = overlapOffsets();
  assert.equal(OVERLAP_STEP_MS, 250);
  assert.deepEqual([offsets[0], offsets.at(-1), offsets.length], [0, 4000, 17]);
  assert.ok(offsets.every((o, i) => i === 0 || o - offsets[i - 1]! <= 250), "no step above 250 ms");
  for (const o of offsets) for (const first of [false, true]) {
    const c = overlapCase(o, first, cases[0]!.factors);
    assert.ok(c.toMs > c.fromMs, `${c.name}: a window`);
  }
});

test("a case's window holds the turn it names: the flip, the gather, the fan's turn and the song change are planned inside it", () => {
  for (const c of cases.filter((x) => ["phrase flip", "gather", "fan"].includes(x.cause))) {
    const v = VARIANTS[genName(c.spec)]!;
    const song = v.cls.songs[c.spec.songIndex]!;
    const cause = c.cause === "phrase flip" ? "flip" : c.cause;
    const planned = songSweeps(song, c.spec.startMs, c.fromMs - 5000, c.toMs + 5000).filter((s) => s.cause === cause);
    assert.ok(planned.some((s) => s.fromMs >= c.fromMs - 1 && s.fromMs <= c.toMs), `${c.name}: no ${cause} starts in ${c.fromMs} to ${c.toMs}`);
  }
});
