// S5b (scene.md "House-look beams"): the floor under the house look's beams, and the check that measures it on
// pixels (tools/beam-floor.ts, the same source CI evaluates in Chrome). The check has its self-test here: a render
// under the floor fails it, one at the floor passes, a core that is not above its haze fails.
import assert from "node:assert/strict";
import { test } from "node:test";
import { feedAt } from "../demo/scenario.ts";
import { RigLoop } from "../src/loop.ts";
import { TAN_H, SceneRig } from "../src/rig.ts";
import { BEAM_BASE_RADIUS } from "../src/scene-shader.ts";
import { HOUSE_BEAM_FLOOR, beamFloor } from "../src/stage-calc.ts";
import { MIN_ABOVE_HAZE, MIN_CORE, floorFaults, makeFloorCheck } from "../tools/beam-floor.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
const check = makeFloorCheck();
const [W, H] = [320, 180];
/** A beam from low in the frame, going up and away. */
const BEAM = { o: [0, -3, -10], d: [0, 0.96, -0.28], spread: 0.05 } as const;
const sRGB = (l: number): number => Math.round((l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055) * 255);
const measure = (px: Uint8ClampedArray) => check.measure(px, W, H, [BEAM], TAN_H, 1, BEAM_BASE_RADIUS)[0]!;

/** World parameter `t` of the axis at screen row `row` (top origin): the projection of the axis, inverted. */
function tAtRow(row: number): number {
  let [lo, hi] = [0, 45];
  for (let i = 0; i < 60; i++) {
    const t = (lo + hi) / 2;
    const r = (1 - ((-3 + 0.96 * t) / ((10 + 0.28 * t) * TAN_H) * 0.5 + 0.5)) * H;
    if (r > row) lo = t; else hi = t;
  }
  return (lo + hi) / 2;
}

/** A frame of linear grey `haze` with the beam's axis drawn as a Gaussian ridge of luminance `core` over it (the shader's profile, projected). */
function frame(haze: number, core: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++) {
    const t = tAtRow(y);
    const radius = ((BEAM_BASE_RADIUS + t * BEAM.spread) / ((10 + 0.28 * t) * TAN_H)) * (H / 2);
    for (let x = 0; x < W; x++) {
      const code = sRGB(haze + (core - haze) * Math.exp(-(((x - W / 2) / radius) ** 2)));
      px.set([code, code, code], (y * W + x) * 4);
    }
  }
  return px;
}

test("S5b self-test: a beam at the floor passes, a render under it fails, a core not above its haze fails", () => {
  const faults = (haze: number, core: number) => floorFaults(measure(frame(haze, core)));
  assert.deepEqual(faults(0.0006, 0.0075), [], "as built: about 0.0075 over 0.0006");
  assert.ok(faults(0.0006, 0.0017).some((f) => f.includes("under")), "the beams at the plain 6 % (0.0017 over 0.0006) are caught");
  assert.ok(faults(0.0006, MIN_CORE * 0.9).length > 0, "a core 10 % under the floor is caught");
  assert.ok(faults(0.0055, 0.0075).some((f) => f.includes("above the haze")), "a core that is bright but not above a haze this bright is caught");
  assert.equal(MIN_CORE, 0.006);
  assert.equal(MIN_ABOVE_HAZE, 15);
});

test("S5b: the check measures the whole axis, so a beam that fades along it is caught where it is under", () => {
  const px = frame(0.0006, 0.0075);
  const m = measure(px);
  assert.ok(m.n >= 10, "samples along the axis");
  // Dim the lower part of the beam (rows 100 down) to the plain 6 % look: the minimum finds it.
  const dim = frame(0.0006, 0.0075);
  const low = frame(0.0006, 0.0017);
  for (let i = 100 * W * 4; i < dim.length; i += 1) dim[i] = low[i]!;
  assert.ok(floorFaults(measure(dim)).length > 0);
});

test("S5b: a beam with no core in the frame fails, it is never passed unmeasured", () => {
  const away = { o: [40, 0, -10], d: [1, 0, 0], spread: 0.05 };
  const m = check.measure(new Uint8ClampedArray(W * H * 4).fill(255), W, H, [away], TAN_H, 1, BEAM_BASE_RADIUS)[0]!;
  assert.equal(m.n, 0);
  assert.ok(floorFaults(m).length > 0);
});

test("S5b: the channel is the token's strongest primary: a margin on another channel does not count", () => {
  const px = frame(0.0006, 0.0075);
  assert.ok(measure(px).minAbove >= MIN_ABOVE_HAZE);
  for (let i = 1; i < px.length; i += 4) px[i] = 255; // the green channel washed out: no margin over the haze on it
  assert.ok(measure(px).minAbove < MIN_ABOVE_HAZE);
});

test("the floor is given before the start only, at a fixed level at every quality level and aspect, and is off when asked", () => {
  assert.equal(beamFloor("before"), HOUSE_BEAM_FLOOR);
  assert.equal(beamFloor("running"), 0);
  // Before the tone map, which lifts a small luminance by about 1.3: the core is the floor over a haze of about 0.0005.
  assert.ok(1 - Math.exp(-1.3 * (HOUSE_BEAM_FLOOR + 0.0005)) >= MIN_CORE * 1.15);
  for (const quality of ["High", "Medium", "Low"] as const) for (const aspect of [16 / 9, 16 / 10, 4 / 3]) {
    const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
    rig.setAspect(aspect);
    rig.apply(loop.step(feedAt(2_000, { stage: "before" }), 0, quality), quality);
    assert.equal(rig.uniform("uFloor"), HOUSE_BEAM_FLOOR, `${quality} ${aspect}`);
    rig.apply(loop.step(feedAt(30_000), 1 / 60, quality), quality);
    assert.equal(rig.uniform("uFloor"), 0, "running: no floor");
  }
  const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
  rig.floorOn = false;
  rig.apply(loop.step(feedAt(2_000, { stage: "before" }), 0, "High"), "High");
  assert.equal(rig.uniform("uFloor"), 0, "the self-test's look without the floor");
});

test("the floor changes nothing else before the start: the haze and the wall stay at the 6 % master, two lit beams, one token", () => {
  const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
  rig.apply(loop.step(feedAt(2_000, { stage: "before" }), 0, "High"), "High");
  assert.equal(rig.beamLevels().filter((v) => v > 0).length, 2, "the shader's floor gate is the beam's own level: the 20 others stay dark");
  assert.equal(rig.uniform("uMaster"), tokens.down);
  assert.equal(rig.uniform("uWallOn"), 0);
  assert.ok(rig.tokenFlags().every((f) => f === 0), "the first zone's token only");
});
