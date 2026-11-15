// Shared test data: a class with the transitions S7 lists (a phrase flip, a song change from a
// mirrored phrase, a build with its drop), and a second class that differs only in its intervals.
import type { SceneClass, SceneInterval, SceneSong } from "../src/frame.ts";

export const songs: readonly SceneSong[] = [
  { bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }], moments: [{ at_ms: 40_000, kind: "drop" }] },
  { bpm: 128, anchors: [{ at_ms: 0, bpm: 128 }] },
  { bpm: 100, anchors: [{ at_ms: 500, bpm: 100 }], moments: [{ at_ms: 10_000, kind: "breakdown" }] },
];
const iv = (startMs: number, zone: number, extra: Record<string, unknown>): SceneInterval => ({ startMs, zone, ...extra });

export const classA: SceneClass = {
  songs, endMs: 300_000,
  intervals: [
    iv(0, 1, { targets: { cadence: [80, 90] }, position: "seated", cue: "easy", pattern: null }),
    iv(60_000, 4, { targets: { cadence: [95, 105] }, position: "standing", cue: "push", pattern: { sides: ["up", "down"] } }),
    iv(180_000, 7, { targets: { cadence: [110, 120] }, position: "seated", cue: "all out", pattern: null }),
  ],
};
/** The same songs and the same zone at every moment as `classA`, but every other interval field differs. */
export const classSameZones: SceneClass = {
  songs, endMs: 300_000,
  intervals: [
    iv(0, 1, { targets: { resistance: [30, 40] }, position: "standing", cue: "climb", pattern: { sides: ["up", "down", "up"] } }),
    iv(60_000, 4, { targets: {}, position: "seated", cue: "", pattern: null }),
    iv(180_000, 7, { targets: { cadence: [60, 70] }, position: "standing", cue: "spin", pattern: null }),
  ],
};
/** The same songs, wholly different intervals: other zones, targets, positions, patterns, cues, times. */
export const classB: SceneClass = {
  songs, endMs: 300_000,
  intervals: [
    iv(0, 6, { targets: { cadence: [60, 70] }, position: "standing", cue: "climb", pattern: { sides: ["up", "down", "up"], start_on: "next_downbeat" } }),
    iv(30_000, 2, { targets: {}, position: "seated", cue: "", pattern: null }),
    iv(200_000, 5, { targets: { cadence: [90, 100] }, position: "seated", cue: "spin", pattern: null }),
  ],
};
