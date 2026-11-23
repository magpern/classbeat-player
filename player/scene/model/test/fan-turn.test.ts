// The fan's turn follows the drop by 2250 ms of the moment alone, and a drop less than 2.25 s before its song's end has none
// (scene.md "The flash budget" item 3, "Moment windows", "How a beam turns"). Rule 4 and S7: the start is the song's, never an
// interval change's, the drop's frame's or a burst's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FAN_FLOOR_MS, FAN_TURN_DELAY_MS, fanTurnStartMs, fanWindowMs } from "../src/fan-turn.ts";
import { sceneFrame } from "../src/frame.ts";
import type { SceneClass, SceneSong } from "../src/frame.ts";
import { momentsAt } from "../src/moments.ts";
import { TURN_DELAY_MS, turningMoments } from "../src/turn-moments.ts";

const DROP = 40_000;
const BEATS_120 = { bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }] } as const;
const moments = [{ at_ms: DROP, kind: "drop" as const }];
const song = (extra: Partial<SceneSong> = {}): SceneSong => ({ ...BEATS_120, moments, ...extra });
const cls = (s: SceneSong, intervals = [{ startMs: 0, zone: 1 }]): SceneClass => ({ songs: [s], intervals, endMs: 200_000 });
const link = { state: "Locked" } as const;
const pans = (c: SceneClass, pos: number) => sceneFrame({ cls: c, classMs: pos, songIndex: 0, songPosMs: pos, phaseDeg: 0, link }).directions.map((d) => d.pan);

test("the fan's turn starts 2250 ms after the drop's moment: the drop's frame (under 1 s from it, P1), its 250 ms decay and 1 s", () => {
  assert.equal(FAN_TURN_DELAY_MS, 1000 + 250 + 1000);
  assert.ok(FAN_TURN_DELAY_MS > TURN_DELAY_MS, "TURN_DELAY_MS stays the least delay of any turn");
  assert.equal(fanTurnStartMs(DROP, 60_000), 42_250);
  assert.equal(fanTurnStartMs(DROP), 42_250, "a song of unknown length has the turn");
  const first = (c: SceneClass) => { for (let p = 40_000; p < 50_000; p++) if (pans(c, p).join() !== pans(c, 39_900).join()) return p; return null; };
  assert.equal(first(cls(song())), 42_250, "the beams leave the gather's aim at the moment plus 2250 ms, to the millisecond");
  // Rule 4, S7: an interval change, even one 0.9 s either side of the drop, moves nothing.
  const merged = cls(song(), [{ startMs: 0, zone: 1 }, { startMs: 40_900, zone: 5 }, { startMs: 39_100, zone: 3 }].sort((a, b) => a.startMs - b.startMs));
  assert.equal(first(merged), 42_250);
  for (const pos of [39_000, 40_000, 41_000, 42_249, 42_250, 44_000, 49_000]) assert.deepEqual(pans(merged, pos), pans(cls(song()), pos), `an interval moves no beam at ${pos}`);
});

test("a drop less than 2.25 s before its song's end has no fan turn: the beams hold the gather's aim until the song change", () => {
  assert.equal(fanTurnStartMs(58_000, 60_000), null);
  assert.equal(fanTurnStartMs(57_751, 60_000), null, "2249 ms before the end");
  assert.equal(fanTurnStartMs(57_750, 60_000), 60_000, "2250 ms before the end has the turn (at the song's end)");
  const late = song({ moments: [{ at_ms: 58_000, kind: "drop" }], lengthMs: 60_000 });
  const held = pans(cls(late), 57_500);
  for (let p = 58_000; p < 60_000; p += 7) {
    assert.equal(turningMoments(late.moments, 120, p, 60_000).fan, false, `no fan target at ${p}`);
    if (p >= 58_650) assert.deepEqual(pans(cls(late), p), held, `the beams hold still at ${p}`);
  }
  assert.equal(turningMoments(late.moments, 120, 59_999, 60_000).gather, true);
  // The fixtures still come on in the drop's frame: the light-side moment is not the turn's.
  assert.equal(momentsAt(late.moments, 120, 58_050).fan, true);
});

test("the turn's moments: the gather's aim from the drop to the fan's turn, the fan for its window plus the delay, then nothing", () => {
  const at = (p: number) => turningMoments(moments, 120, p, 60_000);
  assert.deepEqual([at(39_900).gather, at(39_900).fan], [true, false]);
  assert.deepEqual([at(40_649).gather, at(40_649).fan], [true, false]);
  assert.deepEqual([at(40_650).gather, at(40_650).fan], [true, false], "650 ms after the drop the gather's aim is still held");
  assert.deepEqual([at(42_249).gather, at(42_249).fan], [true, false]);
  assert.deepEqual([at(42_250).gather, at(42_250).fan], [false, true]);
  assert.deepEqual([at(48_649).gather, at(48_649).fan], [false, true], "the fan's window is 8 s at 120 bpm, and the turn out of it follows by 650 ms");
  assert.deepEqual([at(48_650).gather, at(48_650).fan], [false, false]);
  assert.equal(turningMoments(moments, undefined, 42_300).fan, false, "no bpm, no window");
});

test("the drop's fan window lasts at least 6.75 s, so the fan is open within 5.75 s of the moment and for 1 s or more at any tempo", () => {
  assert.equal(FAN_FLOOR_MS, 6750);
  assert.equal(fanWindowMs(120), 8000, "4 bars at 120 bpm");
  assert.equal(fanWindowMs(200), 6750, "4 bars are 4.8 s at 200 bpm: the floor");
  assert.equal(fanWindowMs(60), 16_000);
  for (let bpm = 60; bpm <= 240; bpm += 5) {
    assert.ok(FAN_TURN_DELAY_MS + 3500 <= 5750, "the fan is open within 5.75 s");
    assert.ok(fanWindowMs(bpm) - (FAN_TURN_DELAY_MS + 3500) >= 1000 - 1e-6, `open for 1 s at ${bpm} bpm`);
  }
  assert.equal(momentsAt(moments, 200, DROP + 6_700).fan, true);
  assert.equal(momentsAt(moments, 200, DROP + 6_750).fan, false);
  assert.equal(turningMoments(moments, 200, DROP + 6_750 + 649, 80_000).fan, true, "the target stays the fan until the turn out of it starts");
});
