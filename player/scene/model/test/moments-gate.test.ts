// Scope item 4, the moments gate: `sceneFrame` gates the song's moments by link state. Off the list
// has no moments and no interval bursts; paused and a hold none either (the rig is frozen); every
// other state keeps them, including the None level, as long as the song has a bpm (scene.md
// "Moments at the None level").
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LinkInput, LinkStateName } from "../src/beat-level.ts";
import { sceneFrame } from "../src/frame.ts";
import { gatedBurst, gatedMoments, momentsAllowed, rigFrozen } from "../src/link-gate.ts";
import { NO_MOMENTS, intervalBurst } from "../src/moments.ts";
import { classA } from "./fixtures.ts";

const frameAt = (link: LinkInput, songIndex: number, songPosMs: number) =>
  sceneFrame({ cls: classA, classMs: songPosMs, songIndex, songPosMs, phaseDeg: 40, link });
// Song 0: a drop at 40 s, 120 bpm: the build is 36 to 40 s, the fan 40 to 48 s. Song 2: a breakdown at 10 s.
const GATHERING = 38_000;
const FANNING = 42_000;
const BREAKDOWN = 12_000;

test("a song's moments run in every state that is not paused, held or off the list, including None", () => {
  for (const state of ["Locked", "Coasting", "Ambiguous", "Manual"] as LinkStateName[]) {
    const link = { state };
    assert.equal(frameAt(link, 0, GATHERING).moments.gather, true, `${state} gather`);
    assert.equal(frameAt(link, 0, FANNING).moments.fan, true, `${state} fan`);
    assert.equal(frameAt(link, 2, BREAKDOWN).moments.breakdown, true, `${state} breakdown`);
  }
  assert.equal(frameAt({ state: "Coasting" }, 0, GATHERING).level, "None"); // None level, and the gather runs
});

test("off the list has no gather, no fan and no breakdown, and the beams are not aimed by them", () => {
  const off: LinkInput = { state: "Off the list" };
  for (const [song, pos] of [[0, GATHERING], [0, FANNING], [2, BREAKDOWN]] as const) {
    const f = frameAt(off, song, pos);
    assert.deepEqual(f.moments, NO_MOMENTS);
  }
  const gathered = frameAt({ state: "Locked" }, 0, GATHERING);
  const held = frameAt(off, 0, GATHERING);
  assert.notDeepEqual(held.directions, gathered.directions, "no gather: the beams are aimed as without one");
});

test("the beams' turn follows the moments by 650 ms, and the fan's turn follows the drop by 2250 ms: the gather's aim is held through the drop's burst, the fan's aim comes after, and the fixtures light at the drop", () => {
  const link = { state: "Locked" } as const;
  const pan = (pos: number) => frameAt(link, 0, pos).directions.map((d) => d.pan);
  assert.deepEqual(pan(36_500), pan(35_900), "the gather's turn follows the build's start by 650 ms");
  assert.notDeepEqual(pan(36_700), pan(35_900));
  assert.deepEqual(pan(40_300), pan(39_900), "300 ms after the drop the beams still hold the gather's aim");
  assert.deepEqual(pan(40_700), pan(39_900), "650 ms after the drop they still do: the fan's turn is 2250 ms after the moment");
  assert.deepEqual(pan(42_200), pan(39_900), "2200 ms after it");
  assert.notDeepEqual(pan(42_300), pan(39_900), "2250 ms after the drop the fan's aim is the target");
  assert.equal(frameAt(link, 0, 40_050).moments.fan, true, "the fixtures light in the drop's frame");
});

test("paused and held have none either", () => {
  for (const link of [{ state: "Paused" }, { state: "Locked", held: true }, { state: "Coasting", held: true }] as LinkInput[]) {
    assert.deepEqual(frameAt(link, 0, GATHERING).moments, NO_MOMENTS);
    assert.deepEqual(frameAt(link, 0, FANNING).moments, NO_MOMENTS);
    assert.equal(rigFrozen(link), true);
  }
  assert.equal(rigFrozen({ state: "Off the list" }), false);
});

test("the gate is exactly: not paused, not held, not off the list", () => {
  const states: LinkStateName[] = ["Locked", "Paused", "Coasting", "Off the list", "Ambiguous", "Manual"];
  for (const state of states) for (const held of [false, true]) {
    const link: LinkInput = { state, held };
    assert.equal(momentsAllowed(link), state !== "Paused" && state !== "Off the list" && !held, `${state} held=${held}`);
  }
  const m = { gather: true, fan: false, breakdown: true };
  assert.deepEqual(gatedMoments({ state: "Off the list" }, m), NO_MOMENTS);
  assert.deepEqual(gatedMoments({ state: "Locked" }, m), m);
});

test("no light-only burst on an interval change off the list, paused or held; the others keep the rule", () => {
  for (const link of [{ state: "Off the list" }, { state: "Paused" }, { state: "Locked", held: true }] as LinkInput[]) {
    assert.equal(gatedBurst(link, false, true, null), null);
  }
  for (const state of ["Locked", "Coasting", "Ambiguous", "Manual"] as LinkStateName[]) {
    assert.deepEqual(gatedBurst({ state }, false, true, null), intervalBurst(false, true, null));
    assert.equal(gatedBurst({ state }, true, true, null), null); // a song with moments never bursts
    assert.equal(gatedBurst({ state }, false, true, 9_999), null); // at least 10 s apart
  }
});
