// A position pattern's light (scene.md "What drives what", S8, rule 4): beams at full brightness on the
// "up" side and at 72 % on the "down" side, a 25 % accent on the first beat of each side, at the Beat
// level only; brightness only, so no beam direction ever follows a pattern.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SceneClass } from "../../model/src/index.ts";
import { DEMO_CLASS, SONG_STARTS_MS, feedAt } from "../demo/scenario.ts";
import type { FeedOptions } from "../demo/scenario.ts";
import type { Draw } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { ACCENT_DEPTH, DEFAULT_DOWN, NO_PATTERN_LIGHT, patternLight, readPattern } from "../src/pattern-light-calc.ts";
import { SceneRig } from "../src/rig.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
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
  assert.equal(tokens.patternDown, 0.72, "the token's value");
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
  // Over a whole run, one onset per side (a side is 4.8 s here), so at most 3 a second whatever the tempo.
  const loop = new RigLoop(tokens);
  let [onsets, prev] = [0, 0];
  for (let ms = 118_000, n = 0; ms < 150_000; n++) {
    const d = loop.step(feedAt(ms), n === 0 ? 0 : 1 / 60, "High");
    if (d.sideLight.accent > 0.2 && prev <= 0.2) onsets++;
    prev = d.sideLight.accent;
    ms += d.dtSeconds * 1000;
  }
  assert.equal(onsets, 4, "the interval runs 120 s to 140 s: sides start at beats 41, 49, 57 and 65");
});

test("only where the beat is known (S8): not at the Tempo only or None level, not in the still rig, not off the list, paused or coasting", () => {
  assert.deepEqual(light(DEMO_CLASS, SIDE_START_MS(43), { level: "Tempo only" }), NO_PATTERN_LIGHT);
  assert.deepEqual(light(DEMO_CLASS, SIDE_START_MS(43), { level: "None" }), NO_PATTERN_LIGHT);
  assert.deepEqual(light(DEMO_CLASS, SIDE_START_MS(43), { still: true }), NO_PATTERN_LIGHT);
  const noAnchors = withPattern(DEMO_CLASS.intervals[6]!.pattern, { anchors: [] });
  const run = (options: FeedOptions, cls: SceneClass = DEMO_CLASS) => {
    const loop = new RigLoop(tokens);
    let [lit, n] = [0, 0];
    for (let ms = 121_000; ms < 140_000; n++) {
      const d = loop.step({ ...feedAt(ms, options), cls }, n === 0 ? 0 : 1 / 60, "High");
      lit += d.sideLight.level !== 1 || d.sideLight.accent !== 0 ? 1 : 0;
      ms += d.dtSeconds * 1000;
    }
    return lit;
  };
  assert.ok(run({}) > 500, "locked and anchored: it runs");
  for (const link of [{ state: "Off the list" }, { state: "Paused" }, { state: "Coasting" }, { state: "Locked", held: true }] as const) assert.equal(run({ link }), 0, link.state);
  assert.equal(run({ reducedMotion: true }), 0, "reduced motion");
  assert.equal(run({}, noAnchors), 0, "tempo only: a pulse, no accent");
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

test("the rig dims every lit beam to 72 % on the down side and lifts it by the accent, and its lens with it; the rest is unchanged", () => {
  const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
  // The opacity with the beat lift and the accent divided out: what is left is the side's level and the fixture.
  const opacity = (d: Draw) => { rig.apply(d, "High"); return rig.fixtures.map((f) => (f.beamMaterial.uniforms.uOpacity!.value as number) / ((1 + 2 * d.lift) * (1 + d.sideLight.accent))); };
  const [up, down] = [[] as number[][], [] as number[][]];
  for (let ms = 121_000, n = 0; ms < 128_000; n++) {
    const d = loop.step(feedAt(ms), n === 0 ? 0 : 1 / 60, "High");
    const o = opacity(d);
    if (d.burst === 0) (d.sideLight.level === 1 ? up : down).push(o);
    ms += d.dtSeconds * 1000;
  }
  assert.ok(up.length > 20 && down.length > 20);
  const [a, b] = [up.at(-1)!, down.at(-1)!];
  a.forEach((x, i) => { if (x > 0) assert.ok(Math.abs(b[i]! / x - 0.72) < 0.02, `fixture ${i}: ${b[i]! / x}`); });
  const peak = loop.step(feedAt(SIDE_START_MS(49)), 0, "High");
  assert.ok(peak.sideLight.accent > 0, "the accent reaches the rig's draw");
});

test("rule 4: a pattern changes no beam direction, on any frame of the class", () => {
  const plain = { ...DEMO_CLASS, intervals: DEMO_CLASS.intervals.map((iv) => ({ startMs: iv.startMs, zone: iv.zone })) };
  const [a, b] = [new RigLoop(tokens), new RigLoop(tokens)];
  let frames = 0;
  for (let ms = 100_000, n = 0; ms < 150_000; n++) {
    const f = feedAt(ms);
    const [da, db] = [a.step(f, n === 0 ? 0 : 1 / 60, "High"), b.step({ ...f, cls: plain }, n === 0 ? 0 : 1 / 60, "High")];
    assert.deepEqual(da.drawn, db.drawn, `frame ${n}`);
    assert.deepEqual(da.lit, db.lit);
    ms += da.dtSeconds * 1000;
    frames++;
  }
  assert.ok(frames > 2900);
});
