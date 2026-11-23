// The flash budget in the rig's own loop (scene.md "The flash budget"): which runs the scheduler places, the hold around
// them, the lens flash, N1 (nothing before the start), the build's haze, the wall's chase that travels, and the tokens.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILD_HAZE_STEP, LIFT_CAP, buildHaze } from "../../model/src/index.ts";
import { DEMO_CLASS, SONG_STARTS_MS, feedAt } from "../demo/scenario.ts";
import type { Draw, Feed } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { COMB, comb } from "../src/light-calc.ts";
import { BUDGET_TOKEN_DEFAULTS, readSceneTokens } from "../src/tokens.ts";
import { styleFromCss, tokensFromFile, TOKENS_CSS } from "../tools/tokens-file.ts";
import { readFileSync } from "node:fs";

const tokens = tokensFromFile();
const FRAME = 1 / 60;

function play(fromMs: number, toMs: number, make: (ms: number) => Feed = (ms) => feedAt(ms)): { ms: number; d: Draw }[] {
  const loop = new RigLoop(tokens);
  const out: { ms: number; d: Draw }[] = [];
  let ms = fromMs;
  for (let n = 0; ms < toMs; n++) {
    const d = loop.step(make(ms), n === 0 ? 0 : FRAME, "High");
    out.push({ ms, d });
    ms += d.dtSeconds * 1000;
  }
  return out;
}

/** The demo class with its change at 20 s moved to 24 s: the phrase flip at 16 s plans its sweep to 20.15 s, so the ramp before 20 s is a step in the change frame and one at 24 s has the room. */
const MOVED = { cls: { ...DEMO_CLASS, intervals: DEMO_CLASS.intervals.map((iv) => (iv.startMs === 20_000 ? { ...iv, startMs: 24_000 } : iv)) }, starts: SONG_STARTS_MS };
const movedFeed = (ms: number, link: Feed["link"] = { state: "Locked" }): Feed => feedAt(ms, { link, variant: MOVED });

test("the energy ramp is a run the scheduler places: with the beat and no count it ramps over the 700 ms before the change; without the beat, with a count running, or in a sweep's window, the energy is in the change frame", () => {
  const ramps = (make: (ms: number) => Feed, from: number, to: number) => play(from, to, make).filter((f) => f.d.energyRamp > 0).length;
  assert.ok(ramps((ms) => movedFeed(ms), 23_000, 24_500) >= 38, "locked: about 42 frames of ramp before 24 s");
  assert.equal(ramps((ms) => movedFeed(ms, { state: "Coasting" }), 23_000, 24_500), 0, "coasting: no runs without the beat");
  assert.equal(ramps((ms) => feedAt(ms), 139_000, 140_500), 0, "a count runs in the pattern's interval: no runs, the energy is in the change frame (rule 3)");
  assert.equal(ramps((ms) => feedAt(ms), 19_000, 20_500), 0, "the phrase flip at 16 s plans a sweep to 20.15 s: the ramp before 20 s is a step in the change frame");
  assert.ok(ramps((ms) => feedAt(ms), 79_000, 80_500) >= 38, "after song 1's flip at 75 s (to 79.15 s): the ramp before 80 s has the room");
});

test("beat-like light is held at rest from 250 ms before a run until 300 ms after it: no lift in the hold, lifts outside", () => {
  const frames = play(22_000, 26_000, (ms) => movedFeed(ms));
  // The ramp is 23 300 to 23 983, held from 23 050 until 300 ms after its end. A lift that started before the hold runs out (at most 240 ms: none is cut), and none starts in it.
  const inHold = frames.filter((f) => f.ms >= 23_300 && f.ms < 24_280);
  assert.ok(inHold.length > 50 && inHold.every((f) => f.d.lift === 0), "no lift in the hold");
  assert.ok(frames.some((f) => f.ms >= 23_050 && f.ms < 23_290 && f.d.lift > 0), "a lift that started before the hold is not cut");
  assert.ok(frames.filter((f) => f.ms < 23_000 || f.ms > 24_400).some((f) => f.d.lift > 0.01), "lifts outside it");
  const none = play(22_000, 26_000, (ms) => movedFeed(ms, { state: "Coasting" }));
  assert.ok(none.every((f) => f.d.lift === 0), "and none at all without the beat");
});

test("the lens flash marks an interval change: 160 ms from the change frame, up in 40 ms and down in 120", () => {
  const frames = play(19_500, 20_600);
  const lit = frames.filter((f) => f.d.lens > 0);
  assert.ok(lit.length >= 8 && lit.length <= 11, `${lit.length} frames of flash`);
  assert.ok(lit[0]!.ms >= 20_000 && lit[0]!.ms < 20_040, "it starts on the change frame");
  const peak = Math.max(...lit.map((f) => f.d.lens));
  assert.ok(peak > 0.9 && peak <= 1);
  assert.ok(lit.at(-1)!.ms - lit[0]!.ms < 170, "and is over in 160 ms");
  assert.equal(frames.filter((f) => f.ms < 19_990).filter((f) => f.d.lens > 0).length, 0);
});

test("the lens flash is not drawn in the still rig, off a seek, or while the rig is frozen", () => {
  const at = (from: number, to: number, make?: (ms: number) => Feed) => play(from, to, make).filter((f) => f.d.lens > 0).length;
  assert.ok(at(79_500, 80_600) > 0, "the change at 80 s has no burst (its ramp has the room): the lens flash marks it");
  assert.equal(at(19_500, 20_600, (ms) => feedAt(ms, { reducedMotion: true })), 0, "still rig");
  assert.equal(at(19_500, 20_600, (ms) => feedAt(ms, { link: { state: "Paused" } })), 0, "paused");
  const seek = new RigLoop(tokens);
  seek.step(feedAt(10_000), 0, "High");
  assert.equal(seek.step(feedAt(25_000), FRAME, "High").lens, 0, "a seek across a change");
});

test("N1: no burst, flash, cross or ramp before the start, however the clock sits", () => {
  const frames = play(0, 160_000, (ms) => feedAt(ms, { stage: "before" })).filter((_, i) => i % 7 === 0);
  assert.ok(frames.every((f) => f.d.burst === 0 && f.d.lens === 0 && f.d.cross.front === 2 && f.d.energyRamp === 0 && f.d.lift === 0), "nothing before the start");
});

test("the build's haze steps up 3 % on each beat at the Beat level and stays up; below it it rises as steady light, at most 3 % a second", () => {
  assert.equal(buildHaze(0, 500), 1);
  assert.ok(Math.abs(buildHaze(40, 500) - (1 + BUILD_HAZE_STEP)) < 1e-9, "the first step is done in 40 ms");
  assert.ok(Math.abs(buildHaze(500 * 8 - 1, 500) - (1 + BUILD_HAZE_STEP) ** 8) < 0.01, "about 1.27 times over 8 beats");
  assert.ok(Math.abs(buildHaze(250, 500) - buildHaze(100, 500)) < 1e-9, "it stays up through the fall");
  for (let s = 0; s < 8; s += 0.1) assert.ok(buildHaze(s * 1000 + 100, null) - buildHaze(s * 1000, null) <= 0.003 + 1e-9, "steady: 3 % a second");
  const build = play(36_000, 40_000);
  const lifts = build.map((f) => f.d.lift);
  assert.ok(Math.max(...lifts) <= 0.02 + 1e-9, "2 % lift in a build");
  assert.ok(Math.abs(build.at(-1)!.d.hazeGain - (1 + BUILD_HAZE_STEP) ** 7.9) < 0.06);
  const coasting = play(36_000, 40_000, (ms) => feedAt(ms, { link: { state: "Coasting" } }));
  const gains = coasting.map((f) => f.d.hazeGain);
  assert.ok(gains.every((g, i) => i === 0 || g - gains[i - 1]! <= 0.03 * FRAME + 1e-9), "coasting: the haze rises at most 3 % a second");
});

test("no run of beat-like light alone passes the cap: the beat lift of every zone, the pulse and the accent are at most 5 % of their larger end", () => {
  for (const f of play(100_000, 108_000)) assert.ok(f.d.lift / (1 + f.d.lift) < LIFT_CAP, `lift ${f.d.lift} at ${f.ms}`);
  for (const f of play(119_000, 135_000)) assert.ok(f.d.lift / (1 + f.d.lift) < LIFT_CAP, `lift ${f.d.lift} at ${f.ms} in the pattern`);
  assert.ok(play(122_000, 130_000).some((f) => Math.abs(f.d.lift - 0.05) < 0.004), "the accent peaks at 5 % on a side's first beat");
  assert.ok(0.05 / 1.05 < LIFT_CAP && 0.045 / 1.045 < LIFT_CAP);
});

test("the wall's chase travels: a comb with a lit dot every 6 columns, so any region holds the same number of lit dots, a region that cuts a dot off differing by one dot at most", () => {
  for (let width = COMB; width <= 56; width++) {
    const sums = Array.from({ length: COMB }, (_, head) => Array.from({ length: 56 - width + 1 }, (_, start) => Array.from({ length: width }, (_, k) => comb(start + k, head)).reduce((a, b) => a + b, 0)));
    const all = sums.flat();
    const dot = Array.from({ length: COMB }, (_, k) => comb(k, 0)).reduce((a, b) => a + b, 0); // one dot's light, over the columns it spans
    const spread = (Math.max(...all) - Math.min(...all)) / dot;
    assert.ok(spread <= 1 + 1e-9 && (width % COMB !== 0 || spread < 1e-9), `a region ${width} columns wide: the lit dots differ by ${spread}`);
  }
  assert.deepEqual([0, 1, 2, 3].map((c) => Number(comb(c, 0).toFixed(3))), [1, 0.333, 0, 0], "a tooth and its sides");
});

test("the flash budget's tokens: tokens.css holds them with the spec's values, a value there only ever stricter, and nothing is pending", () => {
  assert.deepEqual([tokens.liftCap, tokens.holdBeforeMs, tokens.holdAfterMs, tokens.lensFlash], [BUDGET_TOKEN_DEFAULTS.liftCap, 250, 300, 0.25]);
  assert.deepEqual(tokens.pending, [], "tokens.css holds every budget token");
  assert.deepEqual(tokens.missing, [], "and nothing else is missing");
  const css = styleFromCss(readFileSync(TOKENS_CSS, "utf8"));
  const given = (v: Record<string, string>) => readSceneTokens({ getPropertyValue: (n) => v[n] ?? css.getPropertyValue(n) });
  const t = given({ "--scene-lift-cap": "0.03", "--scene-hold": "400ms 500ms", "--scene-lens-flash": "0.1" });
  assert.deepEqual([t.liftCap, t.holdBeforeMs, t.holdAfterMs, t.lensFlash, t.pending.length], [0.03, 400, 500, 0.1, 0]);
  const loose = given({ "--scene-lift-cap": "0.5", "--scene-hold": "10ms 10ms", "--scene-lens-flash": "0.9" });
  assert.deepEqual([loose.liftCap, loose.holdBeforeMs, loose.holdAfterMs, loose.lensFlash], [0.05, 250, 300, 0.25], "never raised, never shortened");
});
