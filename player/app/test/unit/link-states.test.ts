// Coasting, Off the list and locking again (ADR 0001 rule 5, the link states, and the rows of the
// spike 1 pass table that can be simulated). The first song starts at t = 1000.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createClock, pause } from "../../src/core/clock/index.ts";
import { DEFAULT_LINK_CONFIG, initialLink, isCurrent, step } from "../../src/core/link/index.ts";
import type { Observation } from "../../src/core/link/index.ts";
import { backwardSteps, classLength, eventsBetween, makePlan, pauseAt, play, run, track } from "./link-harness.ts";
import type { Segment } from "../../src/core/link/index.ts";

const plan = makePlan(["A", "B", "C", "D"]);
const quiet = (from: number, name: string, pos: number, playing: boolean): Segment => ({ from, track: track(name), positionMs: pos, playing, delivering: false });

test("pass table: readings stop: coasting within 3 s, the clock runs on by itself, marked on screen", () => {
  const t = run({ plan, segments: [play(1000, "A", 0), quiet(11_000, "A", 10_000, true)], until: 20_000 });
  assert.equal(t.at(13_000).state, "Locked", "2.1 s after the last reading it is still current");
  assert.equal(t.at(13_500).state, "Coasting");
  assert.ok(t.at(13_500).now - 11_000 <= 3000);
  assert.deepEqual(eventsBetween(t, 11_000, 20_000), ["coasting"]);
  assert.equal(t.at(13_500).view.guessing, true);
  assert.equal(t.at(20_000).classMs, 19_000, "it keeps running");
  assert.deepEqual(backwardSteps(t), []);
});

test("pass table: readings lost while the music is paused for 30 s: back to the music's place, announced, undo offered", () => {
  const t = run({ plan, segments: [play(1000, "A", 0), quiet(11_000, "A", 10_000, false), pauseAt(41_000, "A", 10_000)], until: 45_000 });
  assert.equal(t.at(40_900).state, "Coasting");
  assert.equal(t.at(40_900).classMs, 39_900);
  const back = t.at(41_000);
  assert.equal(back.state, "Paused", "locked again on the first fresh reading");
  assert.deepEqual(back.events, ["relock"]);
  assert.equal(back.classMs, 10_000);
  assert.equal(back.view.announcement, "resynced, 30 s back");
  assert.equal(back.view.canUndo, true);
});

test("pass table: readings lost while the music keeps playing for 30 s: within the interval target, no announcement", () => {
  const t = run({ plan, segments: [play(1000, "A", 0), quiet(11_000, "A", 10_000, true), play(41_000, "A", 40_000)], until: 45_000 });
  assert.equal(t.at(41_000).state, "Locked");
  assert.deepEqual(t.at(41_000).events, ["relock"]);
  assert.ok(Math.abs(t.at(41_000).classMs - 40_000) <= 1000);
  assert.equal(t.at(41_000).view.announcement, null);
  assert.equal(t.at(41_000).view.canUndo, false);
});

// Rule 5: locking again goes to where the music is, in either direction; over 5 s is announced.
const RELOCK: readonly { name: string; returnPos: number; announce: string | null }[] = [
  { name: "forwards by 40 s", returnPos: 80_000, announce: "resynced, 40 s forward" },
  { name: "backwards by 30 s", returnPos: 10_000, announce: "resynced, 30 s back" },
  { name: "forwards by exactly 5 s: not announced", returnPos: 45_000, announce: null },
  { name: "forwards by 5.001 s: announced", returnPos: 45_001, announce: "resynced, 5 s forward" },
  { name: "backwards by exactly 5 s: not announced", returnPos: 35_000, announce: null },
  { name: "backwards by 5.001 s: announced", returnPos: 34_999, announce: "resynced, 5 s back" },
];
for (const c of RELOCK) {
  test(`rule 5: locking again after coasting, ${c.name}`, () => {
    const t = run({ plan, segments: [play(1000, "A", 0), quiet(11_000, "A", 10_000, true), play(41_000, "A", c.returnPos)], until: 43_000 });
    assert.equal(t.at(40_900).state, "Coasting");
    assert.equal(t.at(41_000).classMs, c.returnPos, "the music is the truth, no confirmation");
    assert.equal(t.at(41_000).view.announcement, c.announce);
    assert.equal(t.at(41_000).view.canUndo, c.announce !== null);
  });
}

test("the announcement and its undo expire", () => {
  const t = run({ plan, segments: [play(1000, "A", 0), quiet(11_000, "A", 10_000, false), pauseAt(41_000, "A", 10_000)], until: 75_000 });
  assert.equal(t.at(70_900).view.canUndo, true);
  assert.equal(t.at(71_100).view.canUndo, false);
  assert.equal(t.at(71_100).view.announcement, null);
});

test("a later seek or song change drops an older undo", () => {
  const t = run({
    plan,
    segments: [play(1000, "A", 0), quiet(11_000, "A", 10_000, false), pauseAt(41_000, "A", 10_000), play(45_000, "A", 90_000)],
    until: 47_000,
  });
  assert.equal(t.at(44_900).view.canUndo, true);
  assert.deepEqual(t.at(45_000).events, ["seek"]);
  assert.equal(t.at(45_000).view.canUndo, false);
});

test("pass table: something not in the class (another song, an advert): off the list, the clock keeps running, locks again on return", () => {
  const advert: Segment = { from: 21_000, track: { title: "Buy now!", artist: "Advertiser", lengthMs: 30_000 }, positionMs: 0, playing: true };
  const t = run({ plan, segments: [play(1000, "A", 0), advert, play(51_000, "A", 50_000)], until: 55_000 });
  assert.equal(t.at(21_000).state, "Off the list");
  assert.deepEqual(t.at(21_000).events, ["off_list"]);
  assert.equal(t.at(21_000).view.guessing, true);
  assert.equal(t.at(40_000).classMs, 39_000);
  assert.equal(t.at(51_000).state, "Locked");
  assert.deepEqual(t.at(51_000).events, ["relock"]);
  assert.equal(t.at(51_000).view.announcement, null);
  assert.deepEqual(backwardSteps(t), []);
});

test("pass table: another app playing, even one titled like a class song, is off the list", () => {
  const t = run({ plan, segments: [play(1000, "A", 0), play(21_000, "A", 20_000, { app: "chrome.exe" }), play(31_000, "A", 30_000, { app: "Spotify.exe" })], until: 33_000 });
  assert.equal(t.at(21_000).state, "Off the list");
  assert.equal(t.at(30_900).state, "Off the list");
  assert.equal(t.at(31_000).state, "Locked");
});

test("off the list from a paused clock: the clock runs on by itself, and the instructor can pause it", () => {
  const advert: Segment = { from: 21_000, track: { title: "Buy now!", artist: "Advertiser" }, positionMs: 0, playing: true };
  const t = run({
    plan,
    segments: [play(1000, "A", 0), pauseAt(11_000, "A", 10_000), advert],
    until: 30_000,
    actions: [{ at: 25_000, run: (link, clock, now) => ({ link, clock: pause(clock, now), event: null }) }],
  });
  assert.equal(t.at(11_000).status, "paused");
  assert.equal(t.at(21_000).status, "running");
  assert.equal(t.at(24_900).classMs, 13_900);
  assert.equal(t.at(30_000).status, "paused", "the pause is kept: the clock is not forced to run again");
  assert.equal(t.at(30_000).classMs, 14_000);
});

test("pass table: the music app closed, then restarted: coasting at once, locked again on the first fresh reading", () => {
  const closed: Segment = { from: 11_000, track: null, positionMs: 0, playing: false };
  const t = run({ plan, segments: [play(1000, "A", 0), closed, play(20_000, "A", 0)], until: 22_000 });
  assert.equal(t.at(11_000).state, "Coasting");
  assert.equal(t.at(19_900).classMs, 18_900);
  assert.equal(t.at(20_000).state, "Locked");
  assert.equal(t.at(20_000).classMs, 0, "the restarted app plays from the start, so the clock goes back");
  assert.equal(t.at(20_000).view.announcement, "resynced, 19 s back");
});

test("rule 8: a stale reading is never applied as current", () => {
  const obs: Observation = { ...track("A"), positionMs: 50_000, playing: true, at: 1000, seenAt: 1000 };
  const clock0 = createClock(classLength(plan), 0);
  const locked = step(initialLink(true), clock0, plan, obs, 1000);
  assert.equal(locked.link.state, "Locked");
  const stale = step(locked.link, locked.clock, plan, obs, 1000 + DEFAULT_LINK_CONFIG.staleMs + 1);
  assert.equal(stale.link.state, "Coasting");
  assert.equal(stale.event, "coasting");
  assert.equal(isCurrent(obs, 1000 + DEFAULT_LINK_CONFIG.staleMs, DEFAULT_LINK_CONFIG.staleMs), true);
  assert.equal(isCurrent(obs, 1000 + DEFAULT_LINK_CONFIG.staleMs + 1, DEFAULT_LINK_CONFIG.staleMs), false);
  assert.equal(isCurrent(obs, 999, DEFAULT_LINK_CONFIG.staleMs), false, "a reading from the future is not current either");
});

test("a reader that polls fresh but whose position is old (Windows) is current, and its position is extrapolated", () => {
  const t = run({ plan, segments: [play(1000, "A", 0, { lagMs: 20_000 })], until: 40_000 });
  assert.equal(t.at(40_000).state, "Locked");
  assert.equal(t.at(40_000).classMs, 39_000);
});

test("coasting before anything was ever followed leaves the clock to the instructor", () => {
  const t = run({ plan, segments: [], until: 10_000 });
  assert.ok(t.rows.every((r) => r.state === "Manual" && r.status === "ready"));
});

test("pass table: a full class of play (57 minutes): no drift beyond the interval target", () => {
  const long = makePlan(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"]);
  // Song k starts when the previous one is 171 s in (a 9 s crossfade), as the class designed.
  const segs = long.songs.map((s) => play(1000 + s.startMs, s.title.slice(-1), 0));
  const t = run({ plan: long, segments: segs, until: 3_400_000, stepMs: 1000 });
  const worst = Math.max(...t.rows.filter((r) => r.now >= 1000).map((r) => Math.abs(r.classMs - (r.now - 1000))));
  assert.ok(worst <= 1000, `off by ${worst} ms`);
  assert.deepEqual(backwardSteps(t), []);
});
