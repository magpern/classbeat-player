// A position pattern's light (scene.md "What drives what", S8, rule 4): beams at full brightness on the
// "up" side and at 72 % on the "down" side, a 25 % accent on the first beat of each side, at the Beat
// level only; brightness only. The module is the pattern's parsing and its numbers; nothing draws it yet
// (the flash budget, #577, sets how much of it fits in S6).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SceneClass } from "../../model/src/index.ts";
import { DEMO_CLASS, SONG_STARTS_MS } from "../demo/scenario.ts";
import { ACCENT_DEPTH, DEFAULT_DOWN, NO_PATTERN_LIGHT, patternLight, readPattern } from "../src/pattern-light-calc.ts";
// Song 2 starts at 100 s at 100 bpm (0.6 s a beat); its interval at 120 s starts on beat 33.33, so with `interval_start` the
// first "up" side is beats 33 to 41 (119.8 s to 124.6 s), "down" beats 41 to 49, "up" again from beat 49 (129.4 s).
const BEAT_S = 0.6;
const SIDE_START_MS = (beat: number) => SONG_STARTS_MS[2] + beat * BEAT_S * 1000;

const withPattern = (pattern: unknown, song: Partial<SceneClass["songs"][number]> = {}): SceneClass => ({
  ...DEMO_CLASS,
  songs: DEMO_CLASS.songs.map((s, i) => (i === 2 ? { ...s, ...song } : s)),
  intervals: DEMO_CLASS.intervals.map((iv) => (iv.startMs === 120_000 ? { ...iv, pattern } : iv)),
});
const light = (cls: SceneClass, classMs: number, over: Partial<Parameters<typeof patternLight>[0]> = {}) =>
  patternLight({ cls, classMs, songIndex: 2, songPosMs: classMs - SONG_STARTS_MS[2], level: "Beat", down: DEFAULT_DOWN, still: false, ...over });

test("the pattern is read by its shape and checked: anything else holds none", () => {
  const ok = { positions: ["standing", "seated"], beats: [8, 8], startOn: "interval_start" };
  assert.deepEqual(readPattern(ok), ok);
  for (const bad of [undefined, null, 3, "x", {}, { sides: ["up", "down"] }, { ...ok, beats: [8] }, { ...ok, beats: [8, 0] }, { ...ok, beats: [8, 65] }, { ...ok, beats: [8, 1.5] },
    { ...ok, positions: ["standing", "lying"] }, { ...ok, positions: ["standing"], beats: [8] }, { ...ok, startOn: "now" }, { ...ok, positions: ["standing", "seated", "standing", "seated", "standing"], beats: [1, 1, 1, 1, 1] }]) {
    assert.equal(readPattern(bad), null, JSON.stringify(bad));
  }
});

test("full on the up side, 72 % on the down side, and back to full", () => {
  const cls = DEMO_CLASS;
  const at = (beat: number) => light(cls, SIDE_START_MS(beat) + 400); // late in the first beat of a side: the accent is spent... (checked next)
  assert.equal(at(35).level, 1);
  assert.equal(at(43).level, 0.72);
  assert.equal(at(52).level, 1);
  assert.equal(at(60).level, 0.72);
  assert.equal(light(cls, SIDE_START_MS(43) + 400, { down: 0.5 }).level, 0.5);
});

test("the accent: 25 % on the first beat of each side, within 50 ms of the beat, gone by the next beat, once per side", () => {
  for (const beat of [41, 49, 57]) {
    const t = SIDE_START_MS(beat);
    assert.ok(Math.abs(light(DEMO_CLASS, t + 1).accent - ACCENT_DEPTH) < 0.01, `beat ${beat}: the accent peaks on the beat`);
    assert.ok(light(DEMO_CLASS, t + 50).accent > 0.15, "and is still there 50 ms on");
    assert.ok(light(DEMO_CLASS, t - 20).accent < 0.001, `beat ${beat}: and was not there before it`);
    assert.equal(light(DEMO_CLASS, t + BEAT_S * 1000 + 1).accent < 0.001, true, "gone by the second beat of the side");
    assert.equal(light(DEMO_CLASS, t + 3 * BEAT_S * 1000).accent, 0, "none mid-side");
  }
});

test("only where the beat is known (S8): not at the Tempo only or None level, not in the still rig", () => {
  assert.deepEqual(light(DEMO_CLASS, SIDE_START_MS(43), { level: "Tempo only" }), NO_PATTERN_LIGHT);
  assert.deepEqual(light(DEMO_CLASS, SIDE_START_MS(43), { level: "None" }), NO_PATTERN_LIGHT);
  assert.deepEqual(light(DEMO_CLASS, SIDE_START_MS(43), { still: true }), NO_PATTERN_LIGHT);
});

test("next_downbeat: as the zone until the first downbeat (beat 36), then the first side starts there", () => {
  const cls = withPattern({ positions: ["seated", "standing"], beats: [8, 8], startOn: "next_downbeat" });
  assert.deepEqual(light(cls, SIDE_START_MS(35)), NO_PATTERN_LIGHT);
  assert.ok(Math.abs(light(cls, SIDE_START_MS(36) + 1).accent - ACCENT_DEPTH) < 0.01);
  assert.equal(light(cls, SIDE_START_MS(40)).level, 0.72, "the first side is the pattern's first entry (seated: down)");
  assert.equal(light(cls, SIDE_START_MS(46)).level, 1);
});

test("a side shorter than a third of a second is left out: at most 3 switches a second", () => {
  const quick = { positions: ["standing", "seated"], beats: [1, 1], startOn: "interval_start" };
  assert.deepEqual(light(withPattern(quick, { bpm: 200, anchors: [{ at_ms: 0, bpm: 200 }] }), 121_000), NO_PATTERN_LIGHT);
  assert.notDeepEqual(light(withPattern(quick), 121_000 + BEAT_S * 1000), NO_PATTERN_LIGHT, "at 100 bpm a beat is 0.6 s");
});
