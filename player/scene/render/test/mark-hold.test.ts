// The hold that makes the lit fixtures and the haze's gain change only on a planned mark (src/mark-hold-calc.ts): a change is never drawn 1 s
// or more after it was wanted (C10, P2), a seek, a jump and a change of context pass straight through, and a long frame frees nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SceneClass, SceneSong } from "../../model/src/index.ts";
import { mergeIntervals } from "../../model/src/index.ts";
import { DEMO_CLASS, SONG_STARTS_MS } from "../demo/scenario.ts";
import type { QualityLevel } from "../../model/src/index.ts";
import { FRAME_MS, planMarks } from "../src/marks-calc.ts";
import type { Where } from "../src/marks-calc.ts";
import { MarkHold } from "../src/mark-hold-calc.ts";
import { RigLoop } from "../src/loop.ts";
import { feedAt } from "../demo/scenario.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const OFF = { lit: [false, false, false, false, false, false, false, false], haze: 1 };
const ON = { lit: [true, true, true, true, true, true, true, true], haze: 1 };
const songAt = (classMs: number): number => SONG_STARTS_MS.reduce<number>((at, s, i) => (classMs >= s ? i : at), 0);
const whereOf = (cls: SceneClass, level: Where["level"]) => (classMs: number): Where => {
  const songIndex = songAt(classMs);
  return { cls, classMs, songIndex, songPosMs: classMs - SONG_STARTS_MS[songIndex]!, level };
};

/** The longest wait, over every wanted time in [fromMs, toMs) every 7th frame: how late a change is drawn after the frame it was first wanted. */
function longestWait(cls: SceneClass, level: Where["level"], fromMs: number, toMs: number): { worst: number; late: number } {
  const at = whereOf(mergeIntervals(cls), level);
  let [worst, late] = [0, 0];
  for (let w = fromMs; w < toMs; w += 7 * FRAME_MS) {
    const hold = new MarkHold();
    hold.step(OFF, at(w - FRAME_MS), "c");
    let ms = w;
    for (; ms < w + 5000; ms += FRAME_MS) if (hold.step(ON, at(ms), "c").lit[0] === true) break;
    worst = Math.max(worst, ms - w);
    late += hold.late;
  }
  return { worst, late };
}

const withSong = (index: number, song: Partial<SceneSong>): SceneClass => ({ ...DEMO_CLASS, songs: DEMO_CLASS.songs.map((s, i) => (i === index ? { ...s, ...song } : s)) });

test("a change is drawn less than 1 s after it was wanted: the demo class, an interval change at 20.3 s, an unmerged drop at 30.4 s, 50 bpm", () => {
  const cases: [string, SceneClass, Where["level"], number, number][] = [
    ["the demo class", DEMO_CLASS, "Beat", 3_000, 19_000],
    ["an interval change at 20.3 s", { ...DEMO_CLASS, intervals: DEMO_CLASS.intervals.map((iv) => (iv.startMs === 20_000 ? { ...iv, startMs: 20_300 } : iv)) }, "Beat", 18_000, 26_000],
    ["an unmerged drop at 30.4 s", withSong(0, { moments: [{ at_ms: 30_400, kind: "drop" }] }), "None", 27_000, 36_000],
    ["50 bpm in the count interval", withSong(2, { bpm: 50, anchors: [{ at_ms: 0, bpm: 50 }] }), "Beat", 121_000, 139_000],
  ];
  for (const [name, cls, level, from, to] of cases) {
    const { worst, late } = longestWait(cls, level, from, to);
    assert.ok(worst < 1000, `${name}: a change waited ${Math.round(worst)} ms`);
    assert.equal(late, 0, `${name}: a cause with a mark 1 s or more late`);
  }
});

const at = whereOf(mergeIntervals(DEMO_CLASS), "Beat");
/** A hold with a change wanted at 30.1 s, between two countdown seconds: it is held. */
function held(): MarkHold {
  const hold = new MarkHold();
  hold.step(OFF, at(30_100 - FRAME_MS), "c");
  assert.deepEqual(hold.step(ON, at(30_100), "c").lit, OFF.lit, "held for the mark at 31 s");
  return hold;
}

test("a seek back, a jump forward over 1 s and a change of each part of the context draw the change on the same frame", () => {
  assert.deepEqual(held().step(ON, at(20_000), "c").lit, ON.lit, "a seek back");
  assert.deepEqual(held().step(ON, at(30_500), "c").lit, OFF.lit, "a step of 0.4 s ahead is not a jump");
  assert.deepEqual(held().step(ON, at(30_100 + 1500), "c").lit, ON.lit, "a jump forward");
  const parts = ["High|running|Locked|false|false", "Low|running|Locked|false|false", "High|before|Locked|false|false", "High|running|Coasting|false|false", "High|running|Locked|true|false", "High|running|Locked|false|true"];
  for (const [i, context] of parts.entries()) {
    const hold = new MarkHold();
    hold.step(OFF, at(30_100 - FRAME_MS), parts[0]!);
    if (i > 0) assert.deepEqual(hold.step(ON, at(30_100), context).lit, ON.lit, `a change of context ${i}`);
  }
});

test("a jump forward over 1 s with no mark in it draws a new change on the jump's frame", () => {
  // At 50 bpm the count's beats are 1.2 s apart: a stretch of more than 1.05 s with no mark in it exists, and a jump across it is no mark's.
  const slow = mergeIntervals(withSong(2, { bpm: 50, anchors: [{ at_ms: 0, bpm: 50 }] }));
  const slowAt = whereOf(slow, "Beat");
  const marks = planMarks(slowAt(130_000), 130_000).marks;
  const gap = marks.slice(1).findIndex((m, i) => m - marks[i]! > 1100);
  assert.ok(gap >= 0, "a gap between marks of more than 1.1 s");
  const from = marks[gap]! + 10;
  const hold = new MarkHold();
  hold.step(OFF, slowAt(from), "c");
  assert.deepEqual(hold.step(ON, slowAt(from + 1050), "c").lit, ON.lit);
});

test("a long frame under 1 s with no seek frees nothing: the change still waits for its mark", () => {
  const hold = held();
  assert.deepEqual(hold.step(ON, at(30_700), "c").lit, OFF.lit, "600 ms later, still before the mark at 31 s");
  assert.deepEqual(hold.step(ON, at(31_050), "c").lit, ON.lit, "on the mark at 31 s");
});

test("the quality level passes through in the loop: a lower cap lights fewer fixtures on the frame it is chosen", () => {
  const loop = new RigLoop(tokensFromFile());
  const feed = (ms: number) => feedAt(ms, { link: { state: "Locked" } });
  const lit = (q: QualityLevel, ms: number) => loop.step(feed(ms), 1 / 60, q).lit.filter(Boolean).length;
  const [a, b] = [lit("High", 100_000), lit("High", 100_017)];
  assert.equal(a, b);
  assert.ok(lit("Low", 100_033) < a, "the lower cap shows at once");
});
