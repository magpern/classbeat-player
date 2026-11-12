// The same recording twice in one class (ADR 0001, link state "Ambiguous"): the order settles it
// where it can; otherwise it is reported as ambiguous, never guessed silently, and stays that way
// until a unique song, the order or the instructor settles it. Song A is occurrence 0 and 3.
import assert from "node:assert/strict";
import { test } from "node:test";
import { choose, DEFAULT_LINK_CONFIG, goManual, initialLink, matchCandidates, pickOccurrence } from "../../src/core/link/index.ts";
import type { Segment } from "../../src/core/link/index.ts";
import { createClock, moveTo, start } from "../../src/core/clock/index.ts";
import { backwardSteps, classLength, makePlan, play, run, track } from "./link-harness.ts";

const plan = makePlan(["A", "B", "C", "A", "D"]);
const quiet = (from: number, name: string, pos: number): Segment => ({ from, track: track(name), positionMs: pos, playing: true, delivering: false });

test("both occurrences are candidates for the same recording", () => {
  const obs = { ...track("A"), positionMs: 0, playing: true, at: 0, seenAt: 0 };
  assert.deepEqual(matchCandidates(plan, obs, DEFAULT_LINK_CONFIG), [0, 3]);
});

test("pass table: a cold start on a repeated song is reported as ambiguous, on the occurrence nearest the clock", () => {
  const t = run({ plan, segments: [play(1000, "A", 30_000)], until: 61_000 });
  assert.equal(t.at(1000).state, "Ambiguous");
  assert.deepEqual(t.at(1000).events, ["ambiguous"]);
  assert.deepEqual(t.at(1000).view.candidates, [0, 3]);
  assert.equal(t.at(1000).classMs, 30_000, "the first occurrence is nearest the clock at 0");
});

test("an ambiguity is not guessed away by a later poll: it stays ambiguous a minute later", () => {
  // Spike 1's first review: the second poll silently locked to the first occurrence.
  const t = run({ plan, segments: [play(1000, "A", 30_000)], until: 61_000 });
  for (const now of [1100, 2000, 30_000, 61_000]) {
    assert.equal(t.at(now).state, "Ambiguous", `at ${now}`);
    assert.equal(t.at(now).link.songIndex, 0);
    assert.equal(t.at(now).classMs, 30_000 + (now - 1000));
  }
  assert.ok(t.rows.every((r) => !r.events.includes("locked") && !r.events.includes("resolved")));
});

test("pass table: a cold start on the second occurrence is also ambiguous, never silently locked to the wrong one", () => {
  // The instructor's clock stands in the second occurrence's part of the class.
  const hand = moveTo(start(createClock(classLength(plan), 0), 0), 540_000, 0);
  const t = run({ plan, segments: [play(1000, "A", 30_000)], until: 20_000, clock: hand });
  assert.deepEqual(t.at(1000).events, ["ambiguous"]);
  for (const now of [1000, 20_000]) {
    assert.equal(t.at(now).state, "Ambiguous");
    assert.equal(t.at(now).link.songIndex, 3);
  }
});

test("a unique song after it resolves it: the clock goes where the order says, announced when far", () => {
  // The music is really in the second occurrence (song 3); song D (4) follows it.
  const t = run({ plan, segments: [play(1000, "A", 30_000), play(151_000, "D", 0)], until: 153_000 });
  assert.equal(t.at(150_900).state, "Ambiguous");
  assert.equal(t.at(151_000).state, "Locked");
  assert.deepEqual(t.at(151_000).events, ["resolved"]);
  assert.equal(t.at(151_000).classMs, plan.songs[4].startMs);
  assert.match(t.at(151_000).view.announcement ?? "", /^resynced, \d+ s forward$/);
  assert.equal(t.at(151_000).link.lastSong, 4);
});

test("the ambiguity survives a coast: it is not lost when readings go stale and return", () => {
  // Spike 1's second review: after a coast the next reading resolved it by the clock, silently.
  const t = run({ plan, segments: [play(1000, "A", 30_000), quiet(11_000, "A", 40_000), play(31_000, "A", 60_000)], until: 33_000 });
  assert.equal(t.at(13_500).state, "Coasting");
  assert.equal(t.at(13_500).link.amb?.candidates.join(), "0,3");
  assert.equal(t.at(31_000).state, "Ambiguous");
  assert.ok(!t.at(31_000).events.includes("locked"));
  assert.ok(!t.at(31_000).events.includes("resolved"));
  assert.deepEqual(t.at(31_000).view.candidates, [0, 3]);
});

test("the ambiguity survives an off-the-list stretch too", () => {
  const advert: Segment = { from: 11_000, track: { title: "Buy now!", artist: "Advertiser" }, positionMs: 0, playing: true };
  const t = run({ plan, segments: [play(1000, "A", 30_000), advert, play(21_000, "A", 50_000)], until: 23_000 });
  assert.equal(t.at(11_000).state, "Off the list");
  assert.equal(t.at(21_000).state, "Ambiguous");
});

test("the order settles it where it can: after song C, a repeated A is the second occurrence", () => {
  const t = run({ plan, segments: [play(1000, "C", 0), play(100_000, "A", 0)], until: 102_000 });
  assert.equal(t.at(100_000).state, "Locked");
  assert.equal(t.at(100_000).link.songIndex, 3);
  assert.equal(t.at(100_000).classMs, plan.songs[3].startMs);
});

test("the order settles it where it can: the playing occurrence stays, also across a coast", () => {
  const t = run({ plan, segments: [play(1000, "B", 0), play(10_000, "C", 0), play(20_000, "A", 0), quiet(30_000, "A", 10_000), play(40_000, "A", 30_000)], until: 42_000 });
  assert.equal(t.at(20_000).link.songIndex, 3);
  assert.equal(t.at(40_000).link.songIndex, 3);
  assert.equal(t.at(40_000).state, "Locked");
});

test("the instructor can pick the other occurrence: the clock goes there exactly, with no announcement", () => {
  const t = run({
    plan,
    segments: [play(1000, "A", 30_000)],
    until: 12_000,
    actions: [{ at: 10_000, run: (link, clock) => pickOccurrence(link, clock, 3) }],
  });
  assert.equal(t.at(9_900).state, "Ambiguous");
  assert.deepEqual(t.at(10_000).events, ["pick", "resolved"]);
  assert.equal(t.at(10_000).state, "Locked");
  assert.equal(t.at(10_000).classMs, plan.songs[3].startMs + 39_000);
  assert.equal(t.at(10_000).view.announcement, null);
  assert.equal(t.at(12_000).link.songIndex, 3, "the pick stays while the same recording plays");
  assert.deepEqual(t.at(12_000).view.candidates, []);
});

test("a pick is refused unless the state is Ambiguous and the song is one of its candidates", () => {
  const clock = createClock(1000, 0);
  const calm = initialLink(true);
  assert.equal(pickOccurrence(calm, clock, 3).event, null);
  const ambiguous = { ...calm, state: "Ambiguous" as const, amb: { candidates: [0, 3], index: 0 } };
  assert.equal(pickOccurrence(ambiguous, clock, 1).event, null);
  assert.equal(pickOccurrence(ambiguous, clock, 3).event, "pick");
});

test("a pick ends when a different song plays", () => {
  const t = run({
    plan,
    segments: [play(1000, "A", 30_000), play(20_000, "D", 0)],
    until: 22_000,
    actions: [{ at: 10_000, run: (link, clock) => pickOccurrence(link, clock, 3) }],
  });
  assert.equal(t.at(20_000).link.pick, null);
});

// The choice itself, table-driven: candidates [0, 3], class time and position decide.
const CHOOSE: readonly { name: string; amb: boolean; continuing: boolean; pick: number | null; last: number | null; clockMs: number; index: number; ambiguous: boolean }[] = [
  { name: "no evidence: nearest the clock (first)", amb: false, continuing: false, pick: null, last: null, clockMs: 0, index: 0, ambiguous: true },
  { name: "no evidence: nearest the clock (second)", amb: false, continuing: false, pick: null, last: null, clockMs: 560_000, index: 3, ambiguous: true },
  { name: "the song before the second occurrence settles it", amb: false, continuing: false, pick: null, last: 2, clockMs: 0, index: 3, ambiguous: false },
  { name: "the same occurrence still playing settles it", amb: false, continuing: false, pick: null, last: 0, clockMs: 0, index: 0, ambiguous: false },
  { name: "a song far from both settles nothing", amb: false, continuing: false, pick: null, last: 4, clockMs: 0, index: 0, ambiguous: true },
  { name: "a pick wins", amb: true, continuing: true, pick: 3, last: null, clockMs: 0, index: 3, ambiguous: false },
  { name: "a pick that is not a candidate is ignored", amb: false, continuing: false, pick: 1, last: null, clockMs: 0, index: 0, ambiguous: true },
  { name: "continuing ambiguity stays on its occurrence", amb: true, continuing: true, pick: null, last: 2, clockMs: 560_000, index: 0, ambiguous: true },
  { name: "ambiguity after a coast re-picks the one nearest the clock", amb: true, continuing: false, pick: null, last: 2, clockMs: 560_000, index: 3, ambiguous: true },
];
for (const c of CHOOSE) {
  test(`choose: ${c.name}`, () => {
    const r = choose({ plan, candidates: [0, 3], amb: c.amb ? { candidates: [0, 3], index: 0 } : null, continuing: c.continuing, pick: c.pick, lastSong: c.last, posMs: 30_000, clockMs: c.clockMs });
    assert.deepEqual(r, { index: c.index, ambiguous: c.ambiguous });
  });
}

test("going to the manual clock and back: the next reading is a resync", () => {
  const t = run({
    plan,
    segments: [play(1000, "B", 0)],
    until: 25_000,
    actions: [
      { at: 10_000, run: (link, clock) => goManual(link, clock) },
      { at: 20_000, run: (link, clock) => ({ link: { ...link, mode: "following", state: "Manual" }, clock, event: "relink" }) },
    ],
  });
  assert.equal(t.at(15_000).state, "Manual");
  assert.equal(t.at(20_000).state, "Locked");
  assert.deepEqual(t.at(20_000).events, ["relink", "relock"]);
  assert.deepEqual(backwardSteps(t), []);
});
