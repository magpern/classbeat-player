// S7 (rule 4), as scene.md writes it: two classes that differ only in their intervals (zones,
// targets, positions, patterns, cues), evaluated at the same song, look, phrase, moments and
// motion phase, give every beam the same direction; the motion phase's rate depends only on the
// zone's row, at most 30 degrees a second. Light-only bursts on interval changes change no direction.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURES, beamDirection } from "../src/beams.ts";
import { phraseOfIndex } from "../src/beat-grid.ts";
import { ENERGY_BY_ZONE, MAX_DEG_PER_SECOND, ZONES } from "../src/energy.ts";
import { sceneFrame } from "../src/frame.ts";
import type { SceneClass, SceneInterval } from "../src/frame.ts";
import { LOOKS } from "../src/looks.ts";
import { NO_MOMENTS, intervalBurst, momentsAt } from "../src/moments.ts";
import { advancePhase, phaseRate } from "../src/phase.ts";

const songs = [
  { bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }], moments: [{ at_ms: 40_000, kind: "drop" as const }, { at_ms: 90_000, kind: "build" as const }] },
  { bpm: 128 },
  { bpm: 100, anchors: [{ at_ms: 500, bpm: 100 }], moments: [{ at_ms: 10_000, kind: "breakdown" as const }] },
];
const iv = (startMs: number, zone: number, extra: Record<string, unknown>): SceneInterval => ({ startMs, zone, ...extra });
const classA: SceneClass = {
  songs, endMs: 300_000,
  intervals: [
    iv(0, 1, { targets: { cadence: [80, 90] }, position: "seated", cue: "easy", pattern: null }),
    iv(60_000, 4, { targets: { cadence: [95, 105] }, position: "standing", cue: "push", pattern: { sides: ["up", "down"], start_on: "interval_start" } }),
    iv(180_000, 7, { targets: { cadence: [110, 120] }, position: "seated", cue: "all out", pattern: null }),
  ],
};
// Same songs, wholly different intervals: other zones, targets, positions, patterns, cues, times.
const classB: SceneClass = {
  songs, endMs: 300_000,
  intervals: [
    iv(0, 6, { targets: { cadence: [60, 70], resistance: [30, 40] }, position: "standing", cue: "climb", pattern: { sides: ["up", "down", "up"], start_on: "next_downbeat" } }),
    iv(30_000, 2, { targets: {}, position: "seated", cue: "", pattern: null }),
    iv(200_000, 5, { targets: { cadence: [90, 100] }, position: "seated", cue: "spin", pattern: null }),
  ],
};
const link = { state: "Locked" as const };

test("rule 4: classes that differ only in their intervals aim every beam the same way", () => {
  let compared = 0;
  for (const songIndex of [0, 1, 2, 3, 4]) {
    for (const songPosMs of [0, 1_000, 33_000, 39_000, 41_000, 80_000, 95_000, 120_000]) {
      for (const phaseDeg of [0, 45, 137.5, 300]) {
        for (const classMs of [0, 45_000, 70_000, 190_000, 250_000]) {
          const idx = Math.min(songIndex, songs.length - 1);
          const a = sceneFrame({ cls: classA, classMs, songIndex: idx, songPosMs, phaseDeg, link });
          const b = sceneFrame({ cls: classB, classMs, songIndex: idx, songPosMs, phaseDeg, link });
          assert.deepEqual(a.directions, b.directions);
          assert.equal(a.look, b.look);
          assert.deepEqual([a.phrase, a.moments], [b.phrase, b.moments]);
          compared++;
        }
      }
    }
  }
  assert.ok(compared > 500);
  // The intervals did reach the rig, as scalars only: the classes really differ in energy and colour.
  const a = sceneFrame({ cls: classA, classMs: 0, songIndex: 0, songPosMs: 0, phaseDeg: 0, link });
  const b = sceneFrame({ cls: classB, classMs: 0, songIndex: 0, songPosMs: 0, phaseDeg: 0, link });
  assert.notDeepEqual(a.energy, b.energy);
  assert.notDeepEqual(a.colours, b.colours);
});

test("the motion phase's rate is the zone's row and nothing else, at most 30 degrees a second", () => {
  for (const z of ZONES) {
    assert.equal(phaseRate(z), ENERGY_BY_ZONE[z].degPerSecond);
    assert.ok(phaseRate(z) <= MAX_DEG_PER_SECOND);
    assert.equal(advancePhase(0, 2, z), 2 * phaseRate(z));
  }
  assert.equal(advancePhase(350, 1, 7), 20);
  assert.equal(advancePhase(10, -5, 3), 10);
  assert.equal(phaseRate.length, 1); // the zone number is its only input
  assert.equal(advancePhase.length, 3); // phase, step, zone: no interval
});

test("no beam turns faster than 30 degrees a second at the fastest phase (every look, fixture, phrase)", () => {
  const dt = 0.01;
  for (const look of LOOKS) for (const fixture of FIXTURES) for (const p of [0, 1, 2, 3]) {
    const phrase = phraseOfIndex(p);
    let phase = 0;
    let prev = beamDirection({ look, fixture, phaseDeg: phase, phrase, moments: NO_MOMENTS });
    for (let i = 0; i < 4000; i++) {
      phase = advancePhase(phase, dt, 7);
      const d = beamDirection({ look, fixture, phaseDeg: phase, phrase, moments: NO_MOMENTS });
      const speed = Math.hypot(d.pan - prev.pan, d.tilt - prev.tilt) / dt;
      assert.ok(speed <= MAX_DEG_PER_SECOND, `${look} ${fixture.layer}${fixture.index}: ${speed} deg/s`);
      prev = d;
    }
  }
});

test("moments steer: gather and fan move beams, and the same phase gives the same direction", () => {
  const f = FIXTURES[0]!;
  const base = { look: "fan" as const, fixture: f, phaseDeg: 10, phrase: phraseOfIndex(0) };
  const plain = beamDirection({ ...base, moments: NO_MOMENTS });
  assert.notDeepEqual(beamDirection({ ...base, moments: { ...NO_MOMENTS, gather: true } }), plain);
  assert.notDeepEqual(beamDirection({ ...base, moments: { ...NO_MOMENTS, fan: true } }), plain);
  assert.deepEqual(beamDirection({ ...base, moments: NO_MOMENTS }), plain);
  const drop = [{ at_ms: 40_000, kind: "drop" as const }];
  assert.equal(momentsAt(drop, 120, 39_000).gather, true); // the 8 beats (4 s) before the drop
  assert.equal(momentsAt(drop, 120, 41_000).fan, true);
  assert.equal(momentsAt(drop, 120, 50_000).fan, false); // 4 bars = 8 s
  assert.deepEqual(momentsAt(drop, undefined, 41_000), NO_MOMENTS); // no bpm: nothing guessed
});

test("light-only bursts on interval changes change no direction", () => {
  const burst = intervalBurst(false, true, null);
  assert.ok(burst);
  assert.equal(burst.colour, "white");
  assert.deepEqual(burst.moments, NO_MOMENTS);
  for (const look of LOOKS) for (const fixture of FIXTURES) {
    const input = { look, fixture, phaseDeg: 77, phrase: phraseOfIndex(1) };
    assert.deepEqual(beamDirection({ ...input, moments: burst.moments }), beamDirection({ ...input, moments: NO_MOMENTS }));
  }
  assert.equal(intervalBurst(true, true, null), null); // a song with moments never also bursts
  assert.equal(intervalBurst(false, false, null), null);
  assert.equal(intervalBurst(false, true, 9_999), null); // at least 10 s apart
  assert.ok(intervalBurst(false, true, 10_000));
});
