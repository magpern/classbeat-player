// Following the music: the timing model (ADR 0001 rules 2 to 5 and 8) and the Locked and Paused
// states, on scripted music-app timelines stepped every 100 ms. Times are monotonic ms; the first
// song starts playing at t = 1000, so class time is t - 1000 while locked to song A.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createClock, start } from "../../src/core/clock/index.ts";
import { undo } from "../../src/core/link/index.ts";
import { backwardSteps, classLength, eventsBetween, makePlan, pauseAt, play, run } from "./link-harness.ts";

const plan4 = makePlan(["A", "B", "C", "D"]);

test("locks to the music: class time is the song's start plus its position", () => {
  const t = run({ plan: plan4, segments: [play(1000, "A", 0)], until: 10_000 });
  assert.equal(t.at(900).state, "Manual");
  assert.equal(t.at(1000).state, "Locked");
  assert.deepEqual(t.at(1000).events, ["locked"]);
  for (const now of [2000, 5000, 10_000]) assert.equal(t.at(now).classMs, now - 1000);
  assert.equal(t.at(5000).view.announcement, null);
});

test("a cold start in the middle of a later song goes straight there, without an announcement", () => {
  const t = run({ plan: plan4, segments: [play(1000, "C", 60_000)], until: 3000 });
  assert.equal(t.at(1000).classMs, plan4.songs[2].startMs + 60_000);
  assert.deepEqual(t.at(1000).events, ["locked"]);
  assert.equal(t.at(1000).view.announcement, null);
  assert.equal(t.at(1000).view.canUndo, false);
});

test("rule 2: past the end of its window the clock holds there, then continues with the next song (crossfade off)", () => {
  // Song A plays its whole 180 s; its window is 171 s. Song B starts when A ends.
  const t = run({ plan: plan4, segments: [play(1000, "A", 0), play(181_000, "B", 0)], until: 190_000 });
  assert.equal(t.at(171_900).classMs, 170_900);
  for (const now of [172_100, 176_000, 180_900]) {
    assert.equal(t.at(now).classMs, 171_000, `at ${now}`);
    assert.equal(t.at(now).view.held, true);
    assert.equal(t.at(now).state, "Locked");
  }
  assert.equal(t.at(181_000).classMs, 171_000);
  assert.equal(t.at(181_100).classMs, 171_100);
  assert.equal(t.at(181_100).view.held, false);
  assert.deepEqual(backwardSteps(t), [], "nothing repeats");
  assert.ok(!eventsBetween(t, 0, 190_000).includes("backward"));
});

test("rule 3: the incoming song owns the overlap: an early arrival jumps the clock forward", () => {
  // A longer real crossfade (15 s): B is reported when A is at 165 s, before A's window (171 s) ends.
  const t = run({ plan: plan4, segments: [play(1000, "A", 0), play(166_000, "B", 0)], until: 170_000 });
  assert.equal(t.at(165_900).classMs, 164_900);
  assert.equal(t.at(166_000).classMs, 171_000);
  assert.deepEqual(t.at(166_000).events, ["song_change"]);
  assert.equal(t.at(166_000).view.announcement, null, "a song change is not a resync");
  assert.equal(t.at(167_000).classMs, 172_000);
});

// Rule 4, backward corrections: the same song reports a position earlier than the clock.
const BACKWARD: readonly { name: string; backMs: number; moves: boolean; event: string | null; classMs: number }[] = [
  { name: "smaller than the measuring error is smoothed out", backMs: 300, moves: false, event: null, classMs: 30_000 },
  { name: "exactly the tolerance is still smoothed out", backMs: 500, moves: false, event: null, classMs: 30_000 },
  { name: "just over it is applied, as a backward step", backMs: 600, moves: true, event: "backward", classMs: 29_400 },
  { name: "a one second step back is applied, as a backward step", backMs: 1000, moves: true, event: "backward", classMs: 29_000 },
  { name: "a three second step back is a seek", backMs: 3000, moves: true, event: "seek", classMs: 27_000 },
];
for (const c of BACKWARD) {
  test(`rule 4: a backward correction ${c.name}`, () => {
    const t = run({ plan: plan4, segments: [play(1000, "A", 0), play(31_000, "A", 30_000 - c.backMs)], until: 33_000 });
    assert.equal(t.at(31_000).classMs, c.classMs);
    assert.equal(t.at(31_000).events[0] ?? null, c.event);
    assert.equal(backwardSteps(t).length > 0, c.moves);
  });
}

test("a forward seek in the same song is followed and reported as a seek", () => {
  const t = run({ plan: plan4, segments: [play(1000, "A", 0), play(31_000, "A", 60_000)], until: 33_000 });
  assert.equal(t.at(31_000).classMs, 60_000);
  assert.deepEqual(t.at(31_000).events, ["seek"]);
});

test("pause stops the clock at the music's place, and resume locks again within 3 s", () => {
  const t = run({ plan: plan4, segments: [play(1000, "A", 0), pauseAt(11_000, "A", 10_000), play(21_000, "A", 10_000)], until: 24_000 });
  assert.equal(t.at(11_000).state, "Paused");
  assert.deepEqual(t.at(11_000).events, ["pause"]);
  for (const now of [11_000, 15_000, 20_900]) {
    assert.equal(t.at(now).classMs, 10_000);
    assert.equal(t.at(now).status, "paused");
  }
  assert.equal(t.at(21_000).state, "Locked");
  assert.deepEqual(t.at(21_000).events, ["resume"]);
  assert.equal(t.at(22_000).classMs, 11_000);
  assert.equal(t.at(22_000).status, "running");
});

test("next and previous song: the clock goes where the music is, backwards only on purpose", () => {
  const t = run({ plan: plan4, segments: [play(1000, "A", 0), play(100_000, "B", 0), play(130_000, "A", 0)], until: 135_000 });
  assert.equal(t.at(100_000).classMs, 171_000);
  assert.deepEqual(t.at(100_000).events, ["song_change"]);
  assert.equal(t.at(130_000).classMs, 0, "going to an earlier song replays on purpose");
  assert.deepEqual(t.at(130_000).events, ["song_change"]);
  assert.equal(t.at(130_000).view.announcement, null);
  assert.deepEqual(backwardSteps(t).map((r) => r.now), [130_000]);
});

test("rule 8: a position is extrapolated from the moment the system updated it", () => {
  // Windows style: the position is 8 s old when the reader gets it.
  const t = run({ plan: plan4, segments: [play(1000, "A", 0, { lagMs: 8000 })], until: 20_000 });
  for (const now of [10_000, 20_000]) assert.equal(t.at(now).classMs, now - 1000, `at ${now}`);
});

test("rule 8: a paused position is not extrapolated", () => {
  const t = run({ plan: plan4, segments: [pauseAt(1000, "A", 10_000, { lagMs: 8000 })], until: 20_000 });
  assert.equal(t.at(20_000).classMs, 10_000);
  assert.equal(t.at(20_000).state, "Paused");
});

test("the clock follows the music's rate: a slow music app is followed forward, never back by itself", () => {
  // The music app drifts 400 ms behind at t = 31 s; the clock does not step back.
  const t = run({ plan: plan4, segments: [play(1000, "A", 0), play(31_000, "A", 29_600), play(61_000, "A", 62_000)], until: 65_000 });
  assert.deepEqual(backwardSteps(t), []);
  assert.equal(t.at(61_000).classMs, 62_000, "and a music app ahead of the clock is followed forward");
});

test("the instructor's clock is replaced by the music at the first lock, announced with an undo when far apart (rule 5)", () => {
  const hand = start(createClock(classLength(plan4), 0), 0);
  const t = run({ plan: plan4, segments: [play(21_000, "C", 0)], until: 25_000, clock: hand });
  assert.equal(t.at(20_900).state, "Manual");
  assert.equal(t.at(20_900).classMs, 20_900);
  assert.equal(t.at(21_000).classMs, plan4.songs[2].startMs);
  assert.deepEqual(t.at(21_000).events, ["relock"]);
  assert.equal(t.at(21_000).view.announcement, "resynced, 321 s forward");
  assert.equal(t.at(21_000).view.canUndo, true);
});

test("without a reader or for a manual-only class the clock stays manual and readings change nothing", () => {
  const manual = { ...plan4, manualOnly: true, songs: [] };
  const a = run({ plan: manual, segments: [play(1000, "A", 0)], until: 5000 });
  assert.ok(a.rows.every((r) => r.state === "Manual"));
  assert.equal(a.at(5000).status, "ready");
});

test("an undo takes the clock back to the manual clock where it would have been (rule 5)", () => {
  const t = run({
    plan: plan4,
    segments: [play(1000, "A", 0), play(11_000, "A", 10_000, { delivering: false }), pauseAt(41_000, "A", 10_000)],
    until: 46_000,
    actions: [{ at: 42_000, run: undo }],
  });
  assert.equal(t.at(41_000).classMs, 10_000);
  assert.deepEqual(t.at(42_000).events, ["undo"]);
  assert.equal(t.at(42_000).state, "Manual");
  assert.equal(t.at(42_000).classMs, 41_000, "where the manual clock would be now: 40 s at the resync, plus the 1 s since");
  assert.equal(t.at(46_000).classMs, 45_000, "the clock runs on by hand and the music no longer moves it");
  assert.equal(t.at(46_000).view.canUndo, false);
});
