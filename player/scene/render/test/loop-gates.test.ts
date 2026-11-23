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

function play(make: Make, fromMs: number, toMs: number, dt = 1 / 60, budgetOff = false): Run {
  const loop = new RigLoop(tokens, budgetOff);
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

test("locked: the build gathers, the drop fans, the 58 s drop (away from a change) bursts, the 40 s drop (on a change, beside the ramp) does not, the breakdown runs", () => {
  // At the Beat level the 40 s drop's frame is the interval change's: the ramp (step c) takes the room, so its burst is skipped (step f) and the fan is the drop's frame.
  const a = play(through({ state: "Locked" }), 30_000, 59_500);
  assert.ok(a.gather > 0 && a.fan > 0);
  assert.equal(a.bursts, 1, "the 58 s drop");
  assert.equal(play(through({ state: "Locked" }), 30_000, 59_500, 1 / 60, true).bursts, 2, "budget off: both drops burst, 18 s apart");
  const b = play(through({ state: "Locked" }), 110_000, 128_000);
  assert.ok(b.breakdown > 0);
});

test("the drop's gather, fan and burst also run at the None level (coasting) and when ambiguous, with no lift: both drops burst (no ramp competes at 40 s)", () => {
  for (const state of ["Coasting", "Ambiguous", "Manual"] as const) {
    const a = play(through({ state }), 30_000, 62_000);
    assert.ok(a.gather > 0 && a.fan > 0, state);
    assert.equal(a.bursts, 2, `${state}: the drops at 40 s and 58 s burst`);
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

test("a song with no moments: a light-only burst on its interval change where nothing competes (coasting, 80 s); locked, the ramp has the room and the burst is skipped", () => {
  assert.equal(play(through({ state: "Locked" }), 12_000, 30_000).bursts, 0, "song 0 has moments: no light-only burst on its change at 20 s");
  assert.equal(play(through({ state: "Locked" }), 70_000, 98_000).bursts, 0, "locked: the ramp, the change frame, the decay and steady light would be four");
  assert.equal(play(through({ state: "Coasting" }), 70_000, 98_000).bursts, 1, "coasting: the change frame, the decay and steady light are three");
});

test("drops closer than 10 s share one burst; drops 10 s or more apart each burst (S6)", () => {
  const drops = (...at: number[]): Feed["cls"] => ({ ...DEMO_CLASS, songs: [{ bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }], moments: at.map((at_ms) => ({ at_ms, kind: "drop" as const })) }] });
  const count = (cls: Feed["cls"], budgetOff = false) => {
    const loop = new RigLoop(tokens, budgetOff);
    let [n, was] = [0, 0];
    for (let ms = 30_000, i = 0; ms < 75_000; i++) {
      const d = loop.step({ ...feedAt(ms), cls, songIndex: 0, songPosMs: ms }, i === 0 ? 0 : 1 / 60, "High");
      n += d.burst > 0 && was === 0 ? 1 : 0;
      was = d.burst;
      ms += d.dtSeconds * 1000;
    }
    return n;
  };
  // The spacing is the burst's own, with the budget on (drops away from a change) and off.
  assert.equal(count(drops(44_000, 47_000), true), 1, "budget off: the same spacing");
  assert.equal(count(drops(44_000, 53_900), true), 1, "budget off, just under 10 s: the same spacing");
  assert.equal(count(drops(44_000, 55_000), true), 2, "budget off, 11 s apart: both burst");
  // With the budget on, a drop 3 s after another lies in the first one's gather window and inside its fan's, 11 s after it inside the turn that leaves the fan: no burst is placed there.
  assert.equal(count(drops(44_000, 47_000)), 0, "3 s apart: each lies in the other's sweep window, neither bursts");
  assert.equal(count(drops(44_000, 58_000)), 2, "14 s apart: both burst, clear of every sweep window");
});

const playMasters = (cls: Feed["cls"], from: number, to: number, change: number | null, link: Feed["link"] = { state: "Locked" }): number[] => {
  const loop = new RigLoop(tokens);
  const out: number[] = [];
  for (let ms = from; ms < to; ms += 1000 / 60) {
    const f = feedAt(ms, { link });
    out.push(loop.step(change !== null && ms >= change ? { ...f, cls, songIndex: 2, songPosMs: ms - change } : { ...f, cls }, 1 / 60, "High").master);
  }
  return out;
};

test("a song change away from an interval change has no dim where step g says so: a tick every second leaves no window with both edges and a mark, and the re-aim marks the song", () => {
  // The countdown's seconds are frame marks (text rule 2): a window holding the dim's two edges and one tick is four with steady light's one.
  const masters = playMasters(DEMO_CLASS, 69_000, 72_000, 70_000);
  assert.equal(Math.min(...masters), 1, "no dim");
  // The song change at 70 s is still marked: the beams turn to the new song's look.
  const loop = new RigLoop(tokens);
  let before = "";
  let after = "";
  for (let ms = 69_000; ms < 72_000; ms += 1000 / 60) {
    const f = feedAt(ms);
    const d = loop.step(ms >= 70_000 ? { ...f, songIndex: 2, songPosMs: ms - 70_000 } : f, 1 / 60, "High");
    const key = JSON.stringify(d.drawn);
    if (ms < 70_000) before = key;
    else if (ms > 71_500) after = key;
  }
  assert.notEqual(before, after, "the re-aim marks the song");
  // No state of the demo leaves such a window: a tick comes every second without a count, and with a count there are no runs at all.
  for (const link of [{ state: "Locked" }, { state: "Coasting" }] as const) assert.equal(Math.min(...playMasters(DEMO_CLASS, 69_000, 72_000, 70_000, link)), 1, link.state);
});

test("Tempo only (bpm, no anchors) is as the Beat level: the ramp runs, so a drop away from a change bursts, a drop on a change and a no-moments change do not (the gap, as built)", () => {
  const tempo: Feed["cls"] = { ...DEMO_CLASS, songs: DEMO_CLASS.songs.map((song) => Object.fromEntries(Object.entries(song).filter(([k]) => k !== "anchors")) as typeof song) };
  const make: Make = (ms) => ({ ...feedAt(ms, { link: { state: "Locked" } }), cls: tempo });
  assert.equal(play(make, 30_000, 59_500).bursts, 1, "the 58 s drop bursts, the 40 s drop on a change does not");
  assert.equal(play(make, 70_000, 98_000).bursts, 0, "no moments, a change at 80 s: no light-only burst");
});

test("a seek across an interval change in a song with no moments gives no light-only burst in the jump frame (the class clock is not continuous)", () => {
  for (const state of ["Coasting", "Locked"] as const) {
    const loop = new RigLoop(tokens);
    let seen = 0;
    loop.step(feedAt(70_000, { link: { state } }), 0, "High");
    for (const ms of [90_000, 90_017, 90_033]) seen += loop.step(feedAt(ms, { link: { state } }), 1 / 60, "High").burst > 0 ? 1 : 0;
    assert.equal(seen, 0, state);
  }
});

test("the dim is left out where the scheduler has no room for both edges: beside a burst, and at the None level", () => {
  assert.equal(Math.min(...playMasters(DEMO_CLASS, 58_500, 62_000, 60_000)), 1, "the burst of the song change at 60 s takes the room: the re-aim marks the song");
  assert.equal(Math.min(...playMasters(DEMO_CLASS, 69_000, 72_000, 70_000, { state: "Coasting" })), 1, "no runs without the beat");
});
