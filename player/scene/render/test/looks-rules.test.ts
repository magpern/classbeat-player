// The product rules on the stage looks and the halved movement (#546), rule-sensitive: S5 and rule 7 (every
// colour the rig holds is a zone token or white, on every frame, in every state, the house looks included) and
// reduced motion (S11: no burst, no dim, colour changes at once).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color } from "three";
import type { QualityLevel } from "../../model/src/index.ts";
import { feedAt } from "../demo/scenario.ts";
import type { FeedOptions } from "../demo/scenario.ts";
import type { Draw } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { SceneRig } from "../src/rig.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
const allowed = [...Object.values(tokens.zones), tokens.white];
const direction = (c: Color) => { const m = Math.max(c.r, c.g, c.b) || 1; return [c.r / m, c.g / m, c.b / m]; };
const isHue = (c: Color) => c.r + c.g + c.b === 0 || allowed.some((h) => direction(new Color(h)).every((v, i) => Math.abs(v - direction(c)[i]!) < 1e-3));
const uniform = (u: unknown) => (u as { value: Color }).value.getHex();

/** What is wrong with the colours the rig holds now: every colour is a token or white. */
function colourFaults(rig: SceneRig): string[] {
  const faults: string[] = [];
  const need = (what: string, hex: number) => { if (!allowed.includes(hex)) faults.push(`${what} ${hex.toString(16)}`); };
  rig.fixtures.forEach((f, i) => { need(`beam ${i}`, uniform(f.beamMaterial.uniforms.uColor)); need(`lens ${i}`, f.lensMaterial.color.getHex()); });
  for (const [i, h] of rig.haze.entries()) need(`haze ${i}`, uniform(h.material.uniforms.uColor));
  const wall = rig.wall.mesh.instanceColor!.array;
  for (let i = 0; i < wall.length; i += 3 * 13) if (!isHue(new Color().setRGB(wall[i]!, wall[i + 1]!, wall[i + 2]!))) faults.push(`wall dot ${i / 3}`);
  return faults;
}

const scenarios: readonly (readonly [string, FeedOptions, QualityLevel])[] = [
  ["running", {}, "High"], ["reduced motion", { reducedMotion: true }, "High"], ["coasting", { link: { state: "Coasting" } }, "Medium"],
  ["off the list", { link: { state: "Off the list" } }, "High"], ["paused", { link: { state: "Paused" } }, "Low"],
  ["before the start", { stage: "before" }, "High"],
];

test("S5 and rule 7: on every frame of the class, in every state, each colour is a zone token or white", () => {
  for (const [name, options, quality] of scenarios) {
    const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
    let frames = 0;
    for (let ms = 0, n = 0; ms < 170_000; n++) {
      const d: Draw = loop.step(feedAt(ms, options), n === 0 ? 0 : 1 / 60, quality);
      rig.apply(d, quality);
      assert.deepEqual(colourFaults(rig), [], `${name} at ${ms}`);
      ms += d.dtSeconds * 1000;
      frames++;
    }
    assert.ok(frames > 9000, name);
  }
});

test("the colour check sees a third hue: a mix of two zones, in a beam, a lens, the haze or the wall, is a fault", () => {
  const mix = new Color(tokens.zones[1]).lerp(new Color(tokens.zones[4]), 0.5);
  const fresh = () => { const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)]; rig.apply(loop.step(feedAt(45_000), 0, "High"), "High"); return rig; };
  assert.deepEqual(colourFaults(fresh()), []);
  const mutations: readonly ((rig: SceneRig) => void)[] = [
    (r) => (r.fixtures[3]!.beamMaterial.uniforms.uColor!.value as Color).copy(mix),
    (r) => r.fixtures[3]!.lensMaterial.color.copy(mix),
    (r) => (r.haze[0].material.uniforms.uColor!.value as Color).copy(mix),
    (r) => { const a = r.wall.mesh.instanceColor!.array as unknown as number[]; a[0] = mix.r; a[1] = mix.g; a[2] = mix.b; },
  ];
  for (const [i, mutate] of mutations.entries()) { const rig = fresh(); mutate(rig); assert.ok(colourFaults(rig).length > 0, `mutation ${i} went unseen`); }
});

test("reduced motion (S11): no burst, no dim, no lift; every colour change is one frame", () => {
  const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
  const hues: string[] = [];
  for (let ms = 0, n = 0; ms < 170_000; n++) {
    const d = loop.step(feedAt(ms, { reducedMotion: true }), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    assert.deepEqual([d.burst, d.lift, d.master, d.reduced], [0, 0, 1, true], `at ${ms}`);
    const hue = JSON.stringify(d.front);
    if (hues.at(-1) !== hue) hues.push(hue);
    ms += d.dtSeconds * 1000;
  }
  assert.ok(hues.length >= 8, "the zones change through the class");
});
