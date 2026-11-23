// The one placement of frame marks (scene.md text rule 2, S14): the countdown's seconds, the pattern count's beats, the
// fixed frames, and the invariant that any two marks are at least 500 ms apart, on random classes at every refresh rate's
// frame and on the demo class's variants.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { SceneClass } from "../../model/src/index.ts";
import { VARIANTS } from "../demo/scenario.ts";
import { FRAME_MS, planMarks } from "../src/marks-calc.ts";
import type { Where } from "../src/marks-calc.ts";

const where = (cls: SceneClass, classMs: number, level: Where["level"] = "Beat", songIndex = 0, songStart = 0): Where => ({ cls, classMs, songIndex, songPosMs: classMs - songStart, level });
const gaps = (marks: readonly number[]): number[] => marks.slice(1).map((m, i) => m - marks[i]!);

/** A tiny deterministic generator, so a failing class can be reproduced. */
function random(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

test("any two marks are at least 500 ms apart, on every variant of the demo class in every level", () => {
  for (const [name, v] of Object.entries(VARIANTS)) {
    for (const level of ["Beat", "Tempo only", "None"] as const) {
      for (let at = 0; at < 160_000; at += 9_000) {
        const songIndex = v.starts.findLastIndex((s) => s <= at);
        const { marks } = planMarks(where(v.cls, at, level, songIndex, v.starts[songIndex]!), at);
        assert.ok(gaps(marks).every((g) => g >= 500 - 1e-6), `${name}, ${level}, ${at}: gaps ${gaps(marks).filter((g) => g < 500).join(", ")}`);
      }
    }
  }
});

test("random classes: intervals of any length (1 ms ones included), drops anywhere and any tempo keep every mark 500 ms from every other", () => {
  const next = random(591);
  for (let n = 0; n < 150; n++) {
    const starts = [0];
    for (let i = 0; i < 12; i++) starts.push(starts.at(-1)! + (next() < 0.3 ? 1 + next() * 900 : 800 + next() * 25_000));
    const bpm = 60 + next() * 140;
    const pattern = { positions: ["standing", "seated"], beats: [1 + Math.floor(next() * 8), 1 + Math.floor(next() * 8)], startOn: "interval_start" };
    const cls: SceneClass = {
      songs: [{ bpm, anchors: [{ at_ms: 0, bpm }], moments: [{ at_ms: next() * 60_000, kind: "drop" }, { at_ms: next() * 60_000, kind: "drop" }] }],
      intervals: starts.map((startMs, i) => ({ startMs, zone: 1 + (i % 7), ...(next() < 0.5 ? { pattern } : {}) })),
      endMs: starts.at(-1)! + 20_000,
    };
    for (const level of ["Beat", "Tempo only", "None"] as const) {
      const at = next() * starts.at(-1)!;
      const { marks, placed } = planMarks(where(cls, at, level), at, 6000, { actions: [{ kind: "action", atMs: at + next() * 400 }] });
      assert.ok(gaps(marks).every((g) => g >= 500 - 1e-6), `class ${n}, ${level}: gaps ${gaps(marks).filter((g) => g < 500).join(", ")}`);
      assert.ok(placed.every((p) => p.atMs === null || p.atMs >= p.want.atMs - 1e-6), "a mark is never early");
    }
  }
});

test("the countdown ticks on every second from an interval's start, and the change frame is the interval's first", () => {
  const { cls } = VARIANTS.demo!;
  const { marks } = planMarks(where(cls, 25_000, "None"), 25_000);
  for (const s of [20_000, 21_000, 22_000, 30_000]) assert.ok(marks.some((m) => Math.abs(m - s) < FRAME_MS), `a mark at ${s}`);
  assert.ok(!marks.some((m) => m > 20_100 && m < 20_900), "none between the change frame at 20 s and the tick at 21 s");
});

test("a count runs: the countdown's seconds are not marks of their own, the count steps on every beat up to 120 bpm", () => {
  const { cls } = VARIANTS.demo!; // 100 bpm, 8 up and 8 down from 120 s
  const { marks } = planMarks(where(cls, 125_000, "Beat", 2, 100_000), 125_000);
  const inside = marks.filter((m) => m > 121_000 && m < 129_000);
  assert.ok(inside.length >= 12 && inside.length <= 14, `${inside.length} ticks in 8 s at 100 bpm (a beat is 600 ms)`);
  assert.ok(gaps(inside).every((g) => g >= 590 && g <= 625), "one tick a beat");
});

test("at 180 bpm with four-beat sides the count shows the switch beat and the third beat; with three-beat sides only the switch beat", () => {
  const make = (beats: number[]): SceneClass => ({
    songs: [{ bpm: 180, anchors: [{ at_ms: 0, bpm: 180 }] }],
    intervals: [{ startMs: 0, zone: 2 }, { startMs: 30_000, zone: 3, pattern: { positions: ["standing", "seated"], beats, startOn: "interval_start" } }],
    endMs: 60_000,
  });
  const beat = 60_000 / 180;
  const four = planMarks(where(make([4, 4]), 40_000), 40_000).marks.filter((m) => m > 33_000 && m < 36_000);
  const offsets = four.map((m) => Math.round(((m - 30_000) / beat) % 4));
  assert.ok(offsets.length >= 3 && offsets.every((o) => o === 0 || o === 2), `beats ${offsets.join(" ")} of four`);
  assert.ok(offsets.includes(0) && offsets.includes(2));
  const three = planMarks(where(make([3, 3]), 40_000), 40_000).marks.filter((m) => m > 33_000 && m < 36_000);
  assert.ok(three.every((m) => Math.round(((m - 30_000) / beat) % 3) === 0), "only the switch beat");
});

test("a drop under 1 s from an interval change joins its frame: the marks hold one frame there", () => {
  const { cls } = VARIANTS.collide!; // a change at 40 s and a drop at 40.4 s
  const { fixed, marks } = planMarks(where(cls, 40_000, "None"), 40_000);
  assert.equal(fixed.filter((f) => f.atMs > 39_500 && f.atMs < 41_000).length, 1);
  assert.equal(marks.filter((m) => m > 39_900 && m < 40_900).length, 1);
});

test("one scheduler call: the canvas's runs and the text layer both take their marks from planMarks, and nothing else in src/ places a mark", () => {
  const dir = join(import.meta.dirname, "..", "src");
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(join(dir, f), "utf8")] as const);
  const placing = sources.filter(([, text]) => /\b(placeMarks|fixedFrames)\(/.test(text)).map(([f]) => f).sort();
  assert.deepEqual(placing, ["budget-calc.ts", "marks-calc.ts", "text-merge-calc.ts"], "budget-calc.ts takes a drop's frame (P1), text-merge-calc.ts the merge; the marks are placed in marks-calc.ts only");
  assert.ok(sources.filter(([f]) => f === "budget-calc.ts" || f === "text-clock.ts").every(([, text]) => /\bplanMarks\(/.test(text)), "both layers call planMarks");
  assert.ok(!sources.some(([f, text]) => f !== "marks-calc.ts" && /\bplaceMarks\(/.test(text)), "placeMarks is called in marks-calc.ts only");
});
