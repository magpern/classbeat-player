// The quality step rule on synthetic frame times: each threshold, each step, a short dip, no way back.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PAUSE_MS, STEP_AFTER_MS, STEP_BELOW_FPS, observe, startMonitor } from "../src/quality-monitor.ts";
import type { MonitorState, SecondRow, ShownLevel } from "../src/quality-monitor.ts";
import type { QualityLevel } from "../src/quality.ts";

interface Run { state: MonitorState; rows: SecondRow[]; steps: number; levels: ShownLevel[] }

/** Feed `seconds` of frames at `fps` (whole frames a second) from `fromMs`, on top of `run`. */
function play(run: Run, fps: number, seconds: number, fromMs: number): Run {
  const out: Run = { ...run, rows: [...run.rows], levels: [...run.levels] };
  const total = Math.round(fps * seconds);
  for (let i = 0; i <= total; i++) {
    const r = observe(out.state, fromMs + (i * 1000) / fps);
    out.state = r.state;
    if (r.row) out.rows.push(r.row);
    if (r.stepped) { out.steps++; out.levels.push(r.state.level); }
  }
  return out;
}
const fresh = (level: QualityLevel = "High"): Run => ({ state: startMonitor(level), rows: [], steps: 0, levels: [] });

const CASES: [QualityLevel, ShownLevel][] = [["High", "Medium"], ["Medium", "Low"], ["Low", "Plain"]];
for (const [level, next] of CASES) {
  const threshold = STEP_BELOW_FPS[level];
  test(`${level}: 5 s under ${threshold} fps steps to ${next}`, () => {
    const run = play(fresh(level), threshold - 5, 5.5, 0);
    assert.equal(run.steps, 1);
    assert.equal(run.state.level, next);
  });
  test(`${level}: exactly ${threshold} fps does not step, however long`, () => {
    const run = play(fresh(level), threshold, 20, 0);
    assert.equal(run.steps, 0);
    assert.equal(run.state.level, level);
  });
  test(`${level}: just under ${threshold} fps (${threshold - 1}) steps, so the threshold is the one in the table`, () => {
    assert.equal(play(fresh(level), threshold - 1, 6, 0).state.level, next);
  });
  test(`${level}: under ${threshold} fps for less than 5 s does not step`, () => {
    const run = play(fresh(level), threshold - 5, 4, 0);
    assert.equal(run.steps, 0);
  });
  test(`${level}: a dip of 4 s, a second of recovery, then another dip of 4 s never steps (the count restarts)`, () => {
    let run = play(fresh(level), threshold - 5, 4, 0);
    run = play(run, threshold + 5, 2, 4000);
    run = play(run, threshold - 5, 4, 6000);
    assert.equal(run.steps, 0);
    assert.equal(run.state.level, level);
  });
}

test("one step at a time: High at 48 fps steps to Medium and stays there (Medium's limit is 45)", () => {
  const run = play(fresh("High"), 48, 30, 0);
  assert.deepEqual(run.levels, ["Medium"]);
});

test("a slow computer walks High, Medium, Low, Plain, 5 s per step", () => {
  const run = play(fresh("High"), 20, 30, 0);
  assert.deepEqual(run.levels, ["Medium", "Low", "Plain"]);
  assert.equal(run.state.level, "Plain");
});

test("never back up: after a step, a fast stretch keeps the lower level", () => {
  let run = play(fresh("High"), 40, 6, 0);
  assert.equal(run.state.level, "Medium");
  run = play(run, 144, 30, 7000);
  assert.equal(run.state.level, "Medium");
  assert.equal(run.steps, 1);
});

test("Plain is the end: it never steps and never leaves Plain", () => {
  let run = play(fresh("Low"), 10, 6, 0);
  assert.equal(run.state.level, "Plain");
  run = play(run, 144, 30, 7000);
  assert.equal(run.state.level, "Plain");
});

test("a pause (a gap over the pause limit) is no evidence: no step, the count restarts", () => {
  let run = play(fresh("High"), 40, 4, 0);
  run = play(run, 40, 4, 4000 + PAUSE_MS + 1);
  assert.equal(run.steps, 0);
  const slow = observe(observe(startMonitor("High"), 0).state, PAUSE_MS + 1);
  assert.equal(slow.row, null);
});

test("a stall under the pause limit counts by its length: 1.5 s frames step in 4 frames, not 5 windows", () => {
  let s = observe(startMonitor("High"), 0).state;
  for (const t of [1500, 3000, 4500, 6000, 7500, 9000]) s = observe(s, t).state; // 1.5 s frames, 0.67 fps
  assert.equal(s.level, "Medium");
});

test("the log row is one a second: the window's rate and the level it was drawn at", () => {
  const run = play(fresh("High"), 60, 3, 0);
  assert.equal(run.rows.length, 3);
  assert.deepEqual(run.rows.map((r) => r.second), [0, 1, 2]);
  assert.ok(run.rows.every((r) => Math.abs(r.fps - 60) < 0.01 && r.level === "High"));
  const stepped = play(fresh("High"), 40, 6, 0);
  assert.equal(stepped.rows[4]!.level, "High", "the window that took the step was drawn at High");
  assert.equal(stepped.rows[5]!.level, "Medium");
});

test("the thresholds and the time are the table's numbers (scene.md): High 50, Medium 45, Low 30, 5 s", () => {
  assert.deepEqual({ ...STEP_BELOW_FPS }, { High: 50, Medium: 45, Low: 30 });
  assert.equal(STEP_AFTER_MS, 5000);
});

test("at the table's own numbers: 49 fps steps High, 50 does not; 44 steps Medium, 45 does not; 29 steps Low, 30 does not", () => {
  const steps = (level: QualityLevel, fps: number) => play(fresh(level), fps, 6, 0).steps;
  assert.deepEqual([steps("High", 49), steps("High", 50)], [1, 0]);
  assert.deepEqual([steps("Medium", 44), steps("Medium", 45)], [1, 0]);
  assert.deepEqual([steps("Low", 29), steps("Low", 30)], [1, 0]);
});
