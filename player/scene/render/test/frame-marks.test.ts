// Which frames the steady gate takes a jump out on (src/frame-marks-calc.ts, tools/steady-rate.ts): only frames `planMarks` places a mark on, or
// the person's events; never a frame because the draw changed there. A beam popping on without a mark must stay in the series and be reported.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_CLASS } from "../demo/scenario.ts";
import { plannedMarkIn } from "../src/frame-marks-calc.ts";
import { FRAME_MS } from "../src/marks-calc.ts";
import type { Where } from "../src/marks-calc.ts";
import { worstRate } from "../tools/steady-rate.ts";

const where = (classMs: number): Where => ({ cls: DEMO_CLASS, classMs, songIndex: 0, songPosMs: classMs, level: "Beat" });
const frames = (fromMs: number, toMs: number) => { const t: number[] = []; for (let x = fromMs; x < toMs; x += FRAME_MS) t.push(x); return t; };

test("the frame an interval change falls in is marked, and no frame away from a mark is", () => {
  const t = frames(19_000, 21_000);
  const marked = t.filter((x, i) => i > 0 && plannedMarkIn(where(x), t[i - 1]!, x));
  assert.equal(marked.length, 1, "the change at 20 s");
  assert.ok(Math.abs(marked[0]! - 20_000) <= FRAME_MS);
  assert.equal(plannedMarkIn(where(30_000), 30_000 - FRAME_MS, 30_000), false);
});

test("a beam popping on at a frame no mark names is reported, and fails the gate's measure", () => {
  const t = frames(30_000, 33_000);
  const pop = Math.floor(t.length / 2);
  const luminance = t.map((_, i) => (i < pop ? 0.1 : 0.2));
  // What the demo hands the gate: a cause for a frame only where planMarks has a mark in it.
  const marks = t.map((x, i) => (i > 0 && plannedMarkIn(where(x), t[i - 1]!, x) ? "planned mark" : ""));
  const r = worstRate(t, luminance, t.map(() => false), marks);
  assert.equal(r.unnamedAtMs.length, 1, "the pop is an unnamed jump");
  assert.equal(r.taken.length, 0);
  assert.ok(r.worst > 0.4, "and it stays in the series");
  // The same pop on the change's own frame is the scheduler's and is taken out, with its cause listed.
  const at = frames(19_000, 21_000);
  const change = at.findIndex((x, i) => i > 0 && plannedMarkIn(where(x), at[i - 1]!, x));
  const m2 = at.map((x, i) => (i > 0 && plannedMarkIn(where(x), at[i - 1]!, x) ? "planned mark" : ""));
  const r2 = worstRate(at, at.map((_, i) => (i < change ? 0.1 : 0.2)), at.map(() => false), m2);
  assert.deepEqual(r2.unnamedAtMs, []);
  assert.equal(r2.taken.length, 1);
  assert.equal(r2.taken[0]!.cause, "planned mark");
});

test("a window shorter than its length at the start of a series is not read, and a window below 60 bpm is one beat", () => {
  const t = frames(0, 900);
  assert.equal(worstRate(t, t.map(() => 0.1)).windows, 0, "900 ms holds no whole 1 s window");
  const long = frames(0, 3000);
  assert.ok(worstRate(long, long.map(() => 0.1), [], [], 1500).windows > 0);
  const ramp = long.map((x) => 0.1 * (1 + 0.03 * (x / 1000)));
  assert.ok(worstRate(long, ramp, [], [], 1500).worst > worstRate(long, ramp).worst * 1.4, "a beat of 1.5 s sees a longer move");
});
