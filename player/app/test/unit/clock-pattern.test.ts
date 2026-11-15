// Beat patterns on the class clock (format 1.1), table-driven: "8 up, 8 down" and its edges.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { readClassText } from "../../src/core/class-file.ts";
import { createClock, patternAt, planFrom, start, viewAt } from "../../src/core/clock/index.ts";
import type { ClockPlan, IntervalPattern, SongBeat } from "../../src/core/clock/index.ts";
import { classSchema, EXAMPLES } from "./fixtures.ts";

const UP_DOWN: IntervalPattern = {
  position: "seated",
  positions: ["seated", "standing"],
  beats: [8, 8],
  startOn: "interval_start",
};
const BPM120: SongBeat = { bpm: 120, anchors: [] }; // a beat every 500 ms

function plan(
  pat: IntervalPattern | null,
  songBeats: (SongBeat | null)[] = [BPM120],
  iv = { startMs: 0, endMs: 60_000 },
  songs = [{ startMs: 0, endMs: 120_000 }],
): ClockPlan {
  return {
    lengthMs: 120_000,
    intervals: [iv],
    songs,
    plannedCrossfadeMs: 0,
    manualOnly: false,
    patterns: [pat],
    songBeats,
  };
}

type Row = readonly [name: string, plan: ClockPlan, ms: number, expect: Record<string, unknown>];

const ROWS: Row[] = [
  ["8 up / 8 down: first beat", plan(UP_DOWN), 0, { position: "seated", stepIndex: 0, beat: 1, beatsLeft: 8, nextPosition: "standing" }],
  ["8 up / 8 down: last beat of step 0", plan(UP_DOWN), 3_999, { position: "seated", stepIndex: 0, beat: 8, beatsLeft: 1 }],
  ["8 up / 8 down: step 1 starts at 8 beats", plan(UP_DOWN), 4_000, { position: "standing", stepIndex: 1, beat: 1, beatsLeft: 8, nextPosition: "seated" }],
  ["8 up / 8 down: repeats", plan(UP_DOWN), 8_250, { position: "seated", stepIndex: 0, beat: 1 }],
  [
    "4 entries 2/4/1/3",
    plan({ position: "seated", positions: ["seated", "standing", "seated", "standing"], beats: [2, 4, 1, 3], startOn: "interval_start" }),
    3_100,
    { position: "seated", stepIndex: 2, beat: 1, beatsLeft: 1, nextPosition: "standing" },
  ],
  [
    "4 entries: wraps after the cycle (10 beats)",
    plan({ position: "seated", positions: ["seated", "standing", "seated", "standing"], beats: [2, 4, 1, 3], startOn: "interval_start" }),
    5_100,
    { stepIndex: 0, beat: 1, beatsLeft: 2 },
  ],
  [
    "next_downbeat with an anchor offset: held before the anchor beat",
    plan({ ...UP_DOWN, startOn: "next_downbeat" }, [{ bpm: 120, anchors: [{ atMs: 200, bpm: 120 }] }]),
    100,
    { holding: true, counted: true, position: "seated", stepIndex: null, beat: null, nextPosition: "seated" },
  ],
  [
    "next_downbeat with an anchor offset: step 0 starts on the anchor grid (200 ms)",
    plan({ ...UP_DOWN, startOn: "next_downbeat" }, [{ bpm: 120, anchors: [{ atMs: 200, bpm: 120 }] }]),
    200,
    { holding: false, stepIndex: 0, beat: 1 },
  ],
  [
    "next_downbeat with an anchor offset: 8 beats later (4200 ms) is step 1",
    plan({ ...UP_DOWN, startOn: "next_downbeat" }, [{ bpm: 120, anchors: [{ atMs: 200, bpm: 120 }] }]),
    4_200,
    { stepIndex: 1, beat: 1 },
  ],
  [
    "next_downbeat without an anchor on the grid: interval start on a beat starts at once",
    plan({ ...UP_DOWN, startOn: "next_downbeat" }),
    0,
    { holding: false, stepIndex: 0, beat: 1 },
  ],
  [
    "next_downbeat from the song window start: interval at 100 ms waits for the 500 ms beat",
    plan({ ...UP_DOWN, startOn: "next_downbeat" }, [BPM120], { startMs: 100, endMs: 60_000 }),
    499,
    { holding: true, position: "seated" },
  ],
  [
    "next_downbeat from the song window start: step 0 at 500 ms",
    plan({ ...UP_DOWN, startOn: "next_downbeat" }, [BPM120], { startMs: 100, endMs: 60_000 }),
    500,
    { holding: false, stepIndex: 0, beat: 1 },
  ],
  [
    "anchor tempo change: 60 bpm after the anchor at 4000 ms (1000 ms a beat)",
    plan(UP_DOWN, [{ bpm: 120, anchors: [{ atMs: 0, bpm: 120 }, { atMs: 4_000, bpm: 60 }] }]),
    9_000,
    { stepIndex: 1, beat: 6 },
  ],
  [
    "interval shorter than one cycle: the step shown is the first",
    plan(UP_DOWN, [BPM120], { startMs: 0, endMs: 3_000 }),
    2_999,
    { stepIndex: 0, beat: 6, beatsLeft: 3 },
  ],
  [
    "interval ending mid-step: held at the end, step still counted",
    plan(UP_DOWN, [BPM120], { startMs: 0, endMs: 5_000 }),
    9_000,
    { stepIndex: 1, beat: 3 },
  ],
  ["no bpm on the song: steady positions[0], not counted", plan(UP_DOWN, [null]), 4_000, { counted: false, position: "seated", stepIndex: null, beat: null, beatsLeft: null, nextPosition: null }],
  [
    "anchors without a bpm do not count",
    plan({ ...UP_DOWN, positions: ["standing", "seated"] }, [null]),
    4_000,
    { counted: false, position: "standing" },
  ],
  ["no song window at all: not counted", plan(UP_DOWN, [], { startMs: 0, endMs: 60_000 }, []), 4_000, { counted: false, position: "seated" }],
];

for (const [name, p, ms, expect] of ROWS) {
  test(`pattern: ${name}`, () => {
    const v = patternAt(p, ms);
    assert.ok(v);
    assert.deepEqual({ ...v, ...expect }, v, JSON.stringify(v));
  });
}

test("pattern: an interval without a pattern gives null", () => {
  assert.equal(patternAt(plan(null), 1_000), null);
  assert.equal(patternAt({ ...plan(null), patterns: undefined }, 1_000), null);
});

test("pattern: crossfade or song change inside the interval takes the beat from the song class time is in", () => {
  const p = plan(
    { ...UP_DOWN, beats: [4, 4] },
    [BPM120, { bpm: 60, anchors: [] }],
    { startMs: 0, endMs: 60_000 },
    [{ startMs: 0, endMs: 3_000 }, { startMs: 3_000, endMs: 120_000 }],
  );
  // 0..3000 ms is 6 beats at 120 bpm (step 0 holds 4, step 1 beats 1-2); then 1000 ms a beat.
  assert.deepEqual([patternAt(p, 2_999)?.stepIndex, patternAt(p, 2_999)?.beat], [1, 2]);
  assert.deepEqual([patternAt(p, 3_000)?.stepIndex, patternAt(p, 3_000)?.beat], [1, 3]);
  assert.deepEqual([patternAt(p, 4_500)?.stepIndex, patternAt(p, 4_500)?.beat], [1, 4]);
  assert.deepEqual([patternAt(p, 5_000)?.stepIndex, patternAt(p, 5_000)?.beat], [0, 1]);
  // A song window without a bpm: no count while class time is in it, steady positions[0].
  const gap = plan(UP_DOWN, [BPM120, null], { startMs: 0, endMs: 60_000 }, [{ startMs: 0, endMs: 3_000 }, { startMs: 3_000, endMs: 120_000 }]);
  assert.equal(patternAt(gap, 3_500)?.counted, false);
});

test("pattern: viewAt is unchanged and patternAt is the sibling over the same plan and class time", () => {
  const s = start(createClock(120_000, 0), 0);
  const p = plan(UP_DOWN);
  const v = viewAt(s, p, 4_100);
  assert.equal("pattern" in v, false);
  assert.equal(patternAt(p, v.classMs)?.position, "standing");
});

test("example vector class-pattern-climb-and-jumps loads and yields the expected steps", () => {
  const r = readClassText(readFileSync(join(EXAMPLES, "valid", "class-pattern-climb-and-jumps.json"), "utf8"), classSchema);
  assert.ok(r.ok);
  if (!r.ok) return;
  const p = planFrom(r.doc);
  // Intervals without a pattern.
  assert.equal(patternAt(p, 100_000), null);
  assert.equal(patternAt(p, 400_000), null);
  // Jumps: 480000 ms, song Beta at 128 bpm (468.75 ms a beat), next_downbeat lands on the interval start.
  const at = (ms: number) => patternAt(p, ms);
  assert.deepEqual(
    [at(480_000)?.position, at(480_000)?.beat, at(480_000)?.beatsLeft],
    ["seated", 1, 8],
  );
  assert.deepEqual([at(483_749)?.stepIndex, at(483_749)?.beat], [0, 8]);
  assert.deepEqual([at(483_750)?.position, at(483_750)?.stepIndex, at(483_750)?.beat], ["standing", 1, 1]);
  assert.deepEqual([at(487_500)?.position, at(487_500)?.beat], ["seated", 1]);
  assert.equal(at(539_999)?.counted, true);
  assert.equal(at(540_000), null);
});
