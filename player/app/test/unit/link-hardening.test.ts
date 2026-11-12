// Hardening of the music link's timing and undo (issue 44, from the reviews of PR 38): a skip near a
// song's end is not a crossfade, undo goes to where the clock would have run to, readings that go
// stale while the music is paused, and a backward step clears an older undo. The first song starts
// at t = 1000.
import assert from "node:assert/strict";
import { test } from "node:test";
import { measureCrossfade } from "../../src/core/link/index.ts";
import { MAX_CROSSFADE_MS } from "../../src/core/link/crossfade.ts";
import { undo } from "../../src/core/link/index.ts";
import type { Observation, Segment } from "../../src/core/link/index.ts";
import { eventsBetween, makePlan, pauseAt, play, run, track } from "./link-harness.ts";

const plan = makePlan(["A", "B", "C", "D"]);
const song = plan.songs[0];
const obs = (positionMs: number, at: number): Observation => ({ ...track("A"), positionMs, playing: true, at, seenAt: at });
const quiet = (from: number, name: string, pos: number, playing: boolean): Segment => ({ from, track: track(name), positionMs: pos, playing, delivering: false });
const CLASS_MS = 693_000;

test("a crossfade of 12 s plus tolerance is measured; anything longer is a skip", () => {
  assert.equal(MAX_CROSSFADE_MS, 13_500);
  // Song A at 165.5 s at t = 1000; song B starts at t = 2000, when A was at 166.5 s: 13.5 s of overlap.
  assert.equal(measureCrossfade(song, obs(165_500, 1000), obs(0, 2000)), 13_500);
  assert.equal(measureCrossfade(song, obs(165_499, 1000), obs(0, 2000)), null);
  assert.equal(measureCrossfade(song, obs(160_000, 1000), obs(0, 2000)), null, "a skip at 160 s of 180 s");
});

test("a skip at 160 s of a 180 s song is not a crossfade: the plan's crossfade stays in use", () => {
  const t = run({ plan, segments: [play(1000, "A", 0), play(161_000, "B", 0)], until: 165_000 });
  const row = t.at(164_000);
  assert.equal(row.view.songIndex, 1);
  assert.equal(row.view.measuredCrossfadeMs, null);
  assert.equal(row.view.plannedCrossfadeMs, 9000);
  assert.equal(row.view.crossfadeDiffers, false);
  assert.equal(row.classMs, plan.songs[1].startMs + 3000, "the clock goes to the new song's window");
  assert.equal(row.view.classRemainingMs, CLASS_MS - row.classMs, "time left is the plan's: no hold is added or taken away");
});

test("a skip keeps an earlier measurement, and the countdown and time left stay correct", () => {
  // A to B with a 5 s crossfade (B starts when A is at 175 s), then a skip from B at 100 s into C.
  const bStart = 1000 + 175_000;
  const skipAt = bStart + 100_000;
  const t = run({ plan, segments: [play(1000, "A", 0), play(bStart, "B", 0), play(skipAt, "C", 0)], until: skipAt + 3000 });
  assert.equal(t.at(bStart).view.measuredCrossfadeMs, 5000);
  const after = t.at(skipAt + 2000);
  assert.equal(after.view.songIndex, 2);
  assert.equal(after.view.measuredCrossfadeMs, 5000, "the 80 s overlap of the skip is not a measurement");
  // One change left (C to D), held 4 s longer than planned by the measured 5 s.
  assert.equal(after.view.classRemainingMs, CLASS_MS - after.classMs + 4000);
});

test("a skip near the end does not shorten a later hold's countdown", () => {
  // The skip into B at A's 160 s, then B plays on to the end of its window and holds.
  const t = run({ plan, segments: [play(1000, "A", 0), play(161_000, "B", 0)], until: 161_000 + 175_000, stepMs: 500 });
  const held = t.at(161_000 + 172_000);
  assert.equal(held.view.held, true);
  assert.equal(held.view.holdRemainingMs, 0, "planned 9 s: the next song is already due");
  assert.equal(held.view.measuredCrossfadeMs, null);
});

test("undo goes to where the manual clock would have run to since the resync, not where it was at the resync", () => {
  const segments = [play(1000, "A", 0), quiet(11_000, "A", 10_000, false), pauseAt(41_000, "A", 10_000)];
  const base = run({ plan, segments, until: 41_000 });
  assert.equal(base.at(41_000).view.canUndo, true);
  for (const wait of [100, 1000, 12_300, 29_900]) {
    const t = run({ plan, segments, until: 41_000 + wait + 100, actions: [{ at: 41_000 + wait, run: undo }] });
    const row = t.at(41_000 + wait);
    assert.deepEqual(row.events.filter((e) => e === "undo"), ["undo"], `wait ${wait}`);
    assert.equal(row.classMs, 40_000 + wait, `the clock was at 40 s at the resync and ran on for ${wait} ms`);
    assert.equal(t.at(41_000 + wait + 100).classMs, 40_000 + wait + 100, "and it keeps running by hand");
  }
});

test("readings going stale while the music is paused: coasting within 3 s, the clock runs on, and it locks again on return", () => {
  const t = run({ plan, segments: [play(1000, "A", 0), pauseAt(11_000, "A", 10_000), quiet(21_000, "A", 10_000, false), pauseAt(41_000, "A", 10_000)], until: 45_000 });
  assert.equal(t.at(20_000).state, "Paused");
  assert.equal(t.at(20_000).classMs, 10_000, "the paused music holds the clock");
  assert.equal(t.at(23_400).state, "Paused", "2.4 s after the last reading it is still current");
  assert.equal(t.at(24_000).state, "Coasting");
  assert.ok(24_000 - 21_000 <= 3000);
  assert.deepEqual(eventsBetween(t, 21_000, 40_000), ["coasting"]);
  assert.equal(t.at(24_000).view.guessing, true);
  assert.equal(t.at(30_000).classMs > t.at(24_000).classMs, true, "a coasting clock runs on by itself");
  assert.equal(t.at(41_000).state, "Paused", "locked again to the paused music");
  assert.equal(t.at(41_000).classMs, 10_000);
});

test("a backward step clears an older undo", () => {
  const segments = [play(1000, "A", 0), quiet(11_000, "A", 10_000, false), pauseAt(41_000, "A", 10_000), play(45_000, "A", 10_000), play(50_000, "A", 14_000)];
  const t = run({ plan, segments, until: 51_000 });
  assert.equal(t.at(44_900).view.canUndo, true);
  assert.equal(t.at(44_900).view.announcement !== null, true);
  // At 50 s the music is 1 s behind where the clock was (playing since 45 s): a real backward step, not smoothing.
  assert.deepEqual(t.at(50_000).events, ["backward"]);
  assert.equal(t.at(50_000).view.canUndo, false);
  assert.equal(t.at(50_000).view.announcement, null);
  assert.deepEqual(t.at(45_000).events, ["resume"]);
  assert.equal(t.at(49_900).view.canUndo, true, "a resume leaves it");
});
