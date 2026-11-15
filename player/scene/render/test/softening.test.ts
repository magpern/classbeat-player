// The softening of the mock-up and the haze balance (#546): a beam's edge and a wall dot fade out with no
// hard step, the shaders are built from the same numbers, and the two haze layers of High share the zone's
// ambient glow (scene.md "Energy by zone") instead of adding 1.7 times it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ENERGY_BY_ZONE } from "../../model/src/index.ts";
import { feedAt } from "../demo/scenario.ts";
import { RigLoop } from "../src/loop.ts";
import { SceneRig } from "../src/rig.ts";
import { BEAM_SOFT_EDGE, DOT_INNER, DOT_OUTER, beamEdge, dotFalloff, hazeShares } from "../src/soft-calc.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
const samples = (f: (x: number) => number, n = 1000) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
const biggestStep = (ys: number[]) => Math.max(...ys.slice(1).map((y, i) => Math.abs(y - ys[i]!)));

test("a beam fades to nothing at its silhouette and is whole square-on, with no step between", () => {
  assert.equal(beamEdge(0), 0);
  assert.equal(beamEdge(BEAM_SOFT_EDGE), 1);
  assert.equal(beamEdge(1), 1);
  assert.ok(biggestStep(samples(beamEdge)) < 0.01, "no hard edge: the largest step between 1000 samples");
  assert.ok(samples(beamEdge).every((y, i, a) => i === 0 || y >= a[i - 1]!), "and it only brightens inward");
});

test("a wall dot is round and soft: full in its middle, nothing at its edge, smooth between", () => {
  assert.equal(dotFalloff(0), 1);
  assert.equal(dotFalloff(DOT_INNER), 1);
  assert.equal(dotFalloff(DOT_OUTER), 0);
  assert.ok(biggestStep(samples(dotFalloff)) < 0.02);
  assert.ok(Math.abs(dotFalloff(DOT_INNER + 0.01) - 1) < 0.001 && dotFalloff(DOT_OUTER - 0.01) < 0.001, "flat at both ends, so no visible edge");
});

test("the shaders are built from those numbers: the beam's edge fade, a round wall dot, and no cut-off that would leave a hard edge", () => {
  const rig = new SceneRig(tokens);
  const beam = rig.fixtures[0]!.beamMaterial.fragmentShader;
  assert.ok(beam.includes(`smoothstep(0.0, ${BEAM_SOFT_EDGE.toFixed(2)}, vFacing)`), beam);
  const wall = (rig.wall.mesh.material as unknown as { fragmentShader: string; isShaderMaterial?: boolean });
  assert.equal(wall.isShaderMaterial, true, "the wall is no longer a flat square quad");
  assert.ok(wall.fragmentShader.includes(`smoothstep(${DOT_INNER.toFixed(2)}, ${DOT_OUTER.toFixed(2)}, d)`));
  for (const source of [beam, wall.fragmentShader]) assert.doesNotMatch(source, /\bdiscard\b|\bstep\(/);
});

test("the haze's layers share the zone's ambient glow at every quality level: High is no longer 1.7 times the spec", () => {
  assert.deepEqual([hazeShares(1), hazeShares(2)], [[1, 0], [0.6, 0.4]]);
  for (const classMs of [10_000, 45_000, 85_000, 105_000]) {
    const zone = [1, 4, 6, 7][[10_000, 45_000, 85_000, 105_000].indexOf(classMs)]! as 1 | 4 | 6 | 7;
    for (const quality of ["High", "Medium", "Low"] as const) {
      const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
      const d = loop.step(feedAt(classMs), 0, quality);
      rig.apply(d, quality);
      const total = rig.haze.filter((h) => h.mesh.visible).reduce((a, h) => a + (h.material.uniforms.uLevel!.value as number), 0);
      assert.ok(Math.abs(total - ENERGY_BY_ZONE[zone].ambientGlow) < 1e-9, `zone ${zone} at ${quality}: the haze glows ${total}, the spec says ${ENERGY_BY_ZONE[zone].ambientGlow}`);
    }
  }
});
