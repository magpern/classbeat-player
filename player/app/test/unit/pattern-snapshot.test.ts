// The snapshot's pattern field: side and count at several class times, and null where no count exists.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClockPlan, IntervalPattern, SongBeat } from "../../src/core/clock/index.ts";
import { patternSnapshotAt } from "../../src/core/pattern-snapshot.ts";

const UP_DOWN: IntervalPattern = { position: "seated", positions: ["seated", "standing"], beats: [8, 8], startOn: "interval_start" };
const BPM120: SongBeat = { bpm: 120, anchors: [] }; // a beat every 500 ms

function plan(pat: IntervalPattern | null, songBeats: (SongBeat | null)[] = [BPM120]): ClockPlan {
  return {
    lengthMs: 120_000,
    intervals: [
      { startMs: 0, endMs: 60_000 },
      { startMs: 60_000, endMs: 120_000 },
    ],
    songs: [{ startMs: 0, endMs: 120_000 }],
    plannedCrossfadeMs: 0,
    manualOnly: false,
    patterns: [pat, null],
    songBeats,
  };
}

test("pattern snapshot: side and count at several class times, including the exact switch beat", () => {
  const p = plan(UP_DOWN);
  assert.deepEqual(patternSnapshotAt(p, 0), { position: "seated", beat: 1, beatsLeft: 8, nextPosition: "standing" });
  assert.deepEqual(patternSnapshotAt(p, 1_600), { position: "seated", beat: 4, beatsLeft: 5, nextPosition: "standing" });
  assert.deepEqual(patternSnapshotAt(p, 3_999), { position: "seated", beat: 8, beatsLeft: 1, nextPosition: "standing" });
  assert.deepEqual(patternSnapshotAt(p, 4_000), { position: "standing", beat: 1, beatsLeft: 8, nextPosition: "seated" });
  assert.deepEqual(patternSnapshotAt(p, 8_250), { position: "seated", beat: 1, beatsLeft: 8, nextPosition: "standing" });
});

test("pattern snapshot: null outside a pattern", () => {
  assert.equal(patternSnapshotAt(plan(UP_DOWN), 70_000), null);
  assert.equal(patternSnapshotAt(plan(null), 1_000), null);
});

test("pattern snapshot: null at the None beat level (no bpm, no count)", () => {
  assert.equal(patternSnapshotAt(plan(UP_DOWN, [null]), 1_000), null);
});

test("pattern snapshot: null while a next_downbeat pattern still waits for its first beat", () => {
  const p = plan({ ...UP_DOWN, startOn: "next_downbeat" }, [{ bpm: 120, anchors: [{ atMs: 200, bpm: 120 }] }]);
  assert.equal(patternSnapshotAt(p, 100), null);
  assert.deepEqual(patternSnapshotAt(p, 200), { position: "seated", beat: 1, beatsLeft: 8, nextPosition: "standing" });
});
