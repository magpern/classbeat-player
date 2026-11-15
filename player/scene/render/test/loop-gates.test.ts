// Scope item 4 in the renderer: off the list has no moments and no interval bursts, and the
// renderer passes none on; paused, held and the still rig have none; a burst is light only and
// never steers; bursts are at least 10 s apart. Also the song-change dim and the link-state levels.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_CLASS, feedAt } from "../demo/scenario.ts";
import type { Feed } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
type Make = (classMs: number) => Feed;
interface Run { readonly gather: number; readonly fan: number; readonly breakdown: number; readonly burstFrames: number; readonly bursts: number; readonly minMaster: number; readonly maxLift: number }

function play(make: Make, fromMs: number, toMs: number, dt = 1 / 60): Run {
  const loop = new RigLoop(tokens);
  const r = { gather: 0, fan: 0, breakdown: 0, burstFrames: 0, bursts: 0, minMaster: 1, maxLift: 0 };
  let [classMs, was] = [fromMs, 0];
  for (let n = 0; classMs < toMs; n++) {
    const d = loop.step(make(classMs), n === 0 ? 0 : dt, "High");
    r.gather += d.frame.moments.gather ? 1 : 0;
    r.fan += d.frame.moments.fan ? 1 : 0;
    r.breakdown += d.frame.moments.breakdown ? 1 : 0;
    r.burstFrames += d.burst > 0 ? 1 : 0;
    r.bursts += d.burst > 0 && was === 0 ? 1 : 0;
    r.minMaster = Math.min(r.minMaster, d.master);
    r.maxLift = Math.max(r.maxLift, d.lift);
    was = d.burst;
    classMs += d.dtSeconds * 1000;
  }
  return r;
}
// 30 s to 52 s covers song 0's build (36 s), drop (40 s) and fan; 52 s to 128 s covers song 1 (no moments, interval changes at 80 s
// and 100 s) and song 2's breakdown (120 s) across the interval changes.
const through = (link: Feed["link"], reducedMotion = false): Make => (ms) => feedAt(ms, { link, reducedMotion });

test("locked: the build gathers, the drop bursts once and fans, the breakdown runs", () => {
  const a = play(through({ state: "Locked" }), 30_000, 52_000);
  assert.ok(a.gather > 0 && a.fan > 0);
  assert.equal(a.bursts, 1);
  const b = play(through({ state: "Locked" }), 110_000, 128_000);
  assert.ok(b.breakdown > 0);
});

test("the drop's burst and its gather and fan also run at the None level (coasting) and when ambiguous", () => {
  for (const state of ["Coasting", "Ambiguous", "Manual"] as const) {
    const a = play(through({ state }), 30_000, 52_000);
    assert.ok(a.gather > 0 && a.fan > 0 && a.bursts === 1, state);
    assert.equal(a.maxLift, 0, `${state}: no lift without the beat`);
  }
});

test("off the list: no gather, no fan, no breakdown, no drop burst and no interval burst reach the rig", () => {
  const link = { state: "Off the list" } as const;
  for (const [from, to] of [[30_000, 52_000], [52_000, 128_000]] as const) {
    const r = play(through(link), from, to);
    assert.deepEqual([r.gather, r.fan, r.breakdown, r.burstFrames], [0, 0, 0, 0]);
  }
  assert.equal(play(through(link), 30_000, 52_000).minMaster, 0.6);
});

test("paused and held: no moments, no burst, lights down for paused", () => {
  for (const link of [{ state: "Paused" }, { state: "Locked", held: true }] as const) {
    const r = play(through(link), 30_000, 52_000);
    assert.deepEqual([r.gather, r.fan, r.breakdown, r.burstFrames], [0, 0, 0, 0]);
  }
  assert.equal(play(through({ state: "Paused" }), 30_000, 31_000).minMaster, tokens.down);
});

test("reduced motion: the still rig has no burst, no lift, no moments", () => {
  const r = play(through({ state: "Locked" }, true), 30_000, 128_000);
  assert.deepEqual([r.gather, r.fan, r.breakdown, r.burstFrames, r.maxLift], [0, 0, 0, 0, 0]);
});

test("a song with marked moments never bursts on an interval change; one without does, at least 10 s apart", () => {
  // Song 0 has moments: the interval change at 20 s makes no burst. Song 1 has none: 80 s and 100 s each do.
  assert.equal(play(through({ state: "Locked" }), 12_000, 30_000).bursts, 0);
  const song1 = play(through({ state: "Locked" }), 70_000, 98_000);
  assert.equal(song1.bursts, 1);
  assert.equal(play(through({ state: "Locked" }), 70_000, 98_000, 1 / 144).bursts, 1);
  // Two interval changes closer than 10 s: only the first bursts.
  const cls = { ...DEMO_CLASS, intervals: [{ startMs: 0, zone: 2 }, { startMs: 65_000, zone: 3 }, { startMs: 70_000, zone: 4 }, { startMs: 90_000, zone: 5 }] };
  const loop = new RigLoop(tokens);
  let n = 0;
  let was = 0;
  for (let ms = 62_000; ms < 100_000; ms += 1000 / 60) {
    const d = loop.step({ ...feedAt(ms), cls }, 1 / 60, "High");
    n += d.burst > 0 && was === 0 ? 1 : 0;
    was = d.burst;
  }
  assert.equal(n, 2, "65 s bursts, 70 s is within 10 s and does not, 90 s bursts");
});

test("a song change dims the rig to a quarter for one beat", () => {
  const loop = new RigLoop(tokens);
  const masters: number[] = [];
  for (let ms = 59_000; ms < 61_500; ms += 1000 / 60) masters.push(loop.step(feedAt(ms), 1 / 60, "High").master);
  assert.equal(Math.min(...masters), 0.25);
  const dimmed = masters.filter((m) => m === 0.25).length / 60;
  assert.ok(Math.abs(dimmed - 60 / 128) < 0.05, `dimmed for ${dimmed} s, one beat at 128 bpm is ${60 / 128}`);
});
