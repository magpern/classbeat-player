// The zone 7 row's beams carry a lower share against the haze (scene.md "The zone 7 row's beams carry a lower share against the haze", #618): every
// beam's thrown light at k of today's, the haze, the lens, the wall and the text unchanged, no other row touched, and never a shape or a direction.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ENERGY_BY_ZONE, ZONES, ZONE_7_BEAM_SHARE } from "../../model/src/index.ts";
import { feedAt } from "../demo/scenario.ts";
import type { Variant } from "../demo/scenario.ts";
import { RigLoop } from "../src/loop.ts";
import { SceneRig } from "../src/rig.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();

test("only the zone 7 row has a share below 1, and it is the k the gate accepted, in steps of 0.05 from 0.75", () => {
  for (const z of ZONES) assert.equal(ENERGY_BY_ZONE[z].beamShare, z === 7 ? ZONE_7_BEAM_SHARE : 1, `zone ${z}`);
  assert.ok(ZONE_7_BEAM_SHARE <= 0.75 + 1e-9 && ZONE_7_BEAM_SHARE >= 0.5, "0.75, or lower in steps of 0.05");
  assert.ok(Math.abs(Math.round(ZONE_7_BEAM_SHARE * 20) / 20 - ZONE_7_BEAM_SHARE) < 1e-9, "a multiple of 0.05");
});

test("in zone 7 every beam is k of what it would be at share 1, the haze, the lens and the wall are not, and the directions are not", () => {
  const cls = feedAt(0).cls;
  const variant: Variant = { cls: { ...cls, intervals: [{ startMs: 0, zone: 7 }] }, starts: [0, 60_000, 100_000] };
  const [loop, rig, plain] = [new RigLoop(tokens), new SceneRig(tokens), new SceneRig(tokens)];
  let d = loop.step(feedAt(10_000, { link: { state: "Locked" }, variant }), 0, "High");
  for (let ms = 10_017, n = 0; n < 30; n++, ms += 1000 / 60) d = loop.step(feedAt(ms, { link: { state: "Locked" }, variant }), 1 / 60, "High");
  assert.equal(d.frame.energy.beamShare, ZONE_7_BEAM_SHARE);
  rig.apply(d, "High");
  plain.apply({ ...d, frame: { ...d.frame, energy: { ...d.frame.energy, beamShare: 1 } } }, "High");
  const [a, b] = [rig.beamLevels(), plain.beamLevels()];
  assert.ok(a.some((x) => x > 0), "lit beams");
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]! * ZONE_7_BEAM_SHARE) < 1e-12, `beam ${i}`));
  assert.deepEqual(rig.lensLevels(), plain.lensLevels(), "the lens is unchanged");
  assert.equal(rig.uniform("uAmb"), plain.uniform("uAmb"), "and the haze");
  assert.equal(rig.uniform("uWallLevel"), plain.uniform("uWallLevel"), "and the wall");
  assert.deepEqual(rig.measuredDirections(), plain.measuredDirections(), "no shape or direction moves");
});
