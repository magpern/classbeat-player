// The tokens are read from tokens.css, and the light calculations match scene.md's states.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ENERGY_BY_ZONE, MAX_BEAT_LIFT, QUALITY, ZONES, beatLevel, sceneFrame } from "../../model/src/index.ts";
import { DEMO_CLASS } from "../demo/scenario.ts";
import { BUILD_LIFT_MAX, beatLift, beatStride, burstEnvelope, fixturesLit, litMask, masterLevel, wallDot } from "../src/light-calc.ts";
import { SCENE_TOKEN_DEFAULTS, parseHex, readSceneTokens } from "../src/tokens.ts";
import { TOKENS_CSS, styleFromCss, tokensFromFile } from "../tools/tokens-file.ts";

const css = readFileSync(TOKENS_CSS, "utf8");

test("the zone colours and the white are read from tokens.css, never from a table of the scene's own", () => {
  const t = tokensFromFile();
  for (const z of ZONES) assert.equal(t.zones[z], parseHex(styleFromCss(css).getPropertyValue(`--zone-${z}`)));
  assert.equal(t.zones[4], 0xffe626);
  assert.equal(t.white, parseHex(styleFromCss(css).getPropertyValue("--light-1")));
  assert.throws(() => readSceneTokens({ getPropertyValue: () => "" }), /tokens\.css must be loaded/);
});

test("scene tokens the screens lane has not added yet fall back to the spec and are named", () => {
  const t = tokensFromFile();
  const known = ["--scene-down", "--scene-burst", "--scene-text-cap", "--scene-house", "--pattern-down"];
  assert.ok(t.missing.every((m) => known.includes(m)), t.missing.join(","));
  if (t.missing.includes("--scene-down")) assert.equal(t.down, SCENE_TOKEN_DEFAULTS.down);
  const given = readSceneTokens({ getPropertyValue: (n) => (n === "--scene-burst" ? "0.85, 250 ms" : n === "--scene-down" ? "0.06" : n === "--scene-text-cap" ? "0.08" : n === "--scene-house" ? "0.4" : n === "--pattern-down" ? "0.72" : styleFromCss(css).getPropertyValue(n)) });
  assert.deepEqual([given.burstPeak, given.burstMs, given.down, given.missing], [0.85, 250, 0.06, []]);
});

test("--scene-text-cap fails closed: never above 0.08, and a value that is not a bare positive number is missing", () => {
  const cap = (v: string) => { const t = readSceneTokens({ getPropertyValue: (n) => (n === "--scene-text-cap" ? v : styleFromCss(css).getPropertyValue(n)) }); return [t.textCap, t.missing.includes("--scene-text-cap")]; };
  assert.deepEqual(cap("0.05"), [0.05, false]);
  assert.deepEqual(cap("0.2"), [0.08, false]);
  assert.deepEqual(cap("8 %"), [0.08, true]);
  assert.deepEqual(cap("0"), [0.08, true]);
  assert.deepEqual(cap("none"), [0.08, true]);
});

test("lit fixtures: the zone's count, spread along the rig, capped by the quality level; the fan lights all; a breakdown one", () => {
  for (const z of ZONES) assert.equal(litMask(ENERGY_BY_ZONE[z].lit).filter(Boolean).length, ENERGY_BY_ZONE[z].lit);
  assert.equal(litMask(0).filter(Boolean).length, 0);
  const at = (songPosMs: number, songIndex = 0, zone = 4) => sceneFrame({ cls: { ...DEMO_CLASS, intervals: [{ startMs: 0, zone }] }, classMs: 0, songIndex, songPosMs, phaseDeg: 0, link: { state: "Locked" } });
  assert.equal(fixturesLit(at(10_000), "High").filter(Boolean).length, 15);
  assert.equal(fixturesLit(at(10_000), "Low").filter(Boolean).length, 10);
  assert.equal(fixturesLit(at(42_000), "High").filter(Boolean).length, QUALITY.High.fixtures);
  assert.equal(fixturesLit(at(42_000), "Medium").filter(Boolean).length, QUALITY.Medium.fixtures);
  assert.equal(fixturesLit(at(25_000, 2), "High").filter(Boolean).length, 1);
});

test("the beat lift: only at the Beat level on the beat, at most 3 a second, at most 45 % (55 % in a build), none in the still rig", () => {
  const frame = (pos: number, link: { state: "Locked" | "Coasting" }, zone = 7) =>
    sceneFrame({ cls: { ...DEMO_CLASS, intervals: [{ startMs: 0, zone }] }, classMs: 0, songIndex: 0, songPosMs: pos, phaseDeg: 0, link });
  const f = frame(10_000, { state: "Locked" });
  assert.equal(f.level, "Beat");
  assert.equal(beatLift({ frame: f, bpm: 120, beats: 20, songPosMs: 10_000, reduced: false }), ENERGY_BY_ZONE[7].beatLift); // on the beat
  assert.ok(beatLift({ frame: f, bpm: 120, beats: 20.5, songPosMs: 10_000, reduced: false }) < MAX_BEAT_LIFT * 0.2);
  assert.equal(beatLift({ frame: f, bpm: 120, beats: 20, songPosMs: 10_000, reduced: true }), 0);
  const none = frame(10_000, { state: "Coasting" });
  assert.equal(beatLevel({ state: "Coasting" }, DEMO_CLASS.songs[0]!), "None");
  assert.equal(beatLift({ frame: none, bpm: 120, beats: 20, songPosMs: 10_000, reduced: false }), 0);
  const build = frame(38_000, { state: "Locked" });
  assert.ok(beatLift({ frame: build, bpm: 120, beats: 76, songPosMs: 38_000, reduced: false }) <= BUILD_LIFT_MAX);
  assert.equal(beatStride(180), 1);
  assert.equal(beatStride(181), 2); // above 180 bpm every second beat
  let lifts = 0;
  const fast = frame(10_000, { state: "Locked" });
  for (let i = 0; i < 6; i++) if (beatLift({ frame: fast, bpm: 200, beats: 10 + i, songPosMs: 0, reduced: false }) > 0.4) lifts++;
  assert.equal(lifts, 3, "above 180 bpm every second beat lifts");
});

test("tempo only: a 12 % pulse and nothing at None; no wall chase without the beat", () => {
  const noAnchors = { ...DEMO_CLASS, songs: [{ bpm: 120 }], intervals: [{ startMs: 0, zone: 4 }] };
  const f = sceneFrame({ cls: noAnchors, classMs: 0, songIndex: 0, songPosMs: 5_000, phaseDeg: 0, link: { state: "Locked" } });
  assert.equal(f.level, "Tempo only");
  assert.ok(beatLift({ frame: f, bpm: 120, beats: null, songPosMs: 5_000, reduced: false }) <= 0.12);
  assert.ok(wallDot(10, 3, "beat chase", null, 5, false) < 0.31);
  assert.ok(wallDot(0, 3, "beat chase", 0, 5, false) > 0.6); // the chase head, with the beat known
  assert.equal(wallDot(10, 3, "beat chase", 2, 5, true), 0.2); // the still rig's wall does not move
});

test("master level and burst envelope", () => {
  assert.equal(masterLevel({ state: "Locked" }, 0.06, false), 1);
  assert.equal(masterLevel({ state: "Paused" }, 0.06, false), 0.06);
  assert.equal(masterLevel({ state: "Locked", held: true }, 0.06, false), 0.06);
  assert.equal(masterLevel({ state: "Off the list" }, 0.06, false), 0.6);
  assert.equal(masterLevel({ state: "Locked" }, 0.06, true), 0.25);
  assert.deepEqual([null, 0, 125, 250, 400].map((ms) => burstEnvelope(ms, 250)), [0, 1, 0.5, 0, 0]);
});
