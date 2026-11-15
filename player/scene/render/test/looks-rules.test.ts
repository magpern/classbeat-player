// The product rules on the deferred looks (#546), rule-sensitive: S5 and rule 7 (never a third hue: every
// colour the rig holds is a zone token or white, through the cross, the flash and the house looks, on
// every frame) and reduced motion (S11: no cross, no flash, no burst, no accent; colour changes at once).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color } from "three";
import type { QualityLevel } from "../../model/src/index.ts";
import { DEMO_CLASS, feedAt } from "../demo/scenario.ts";
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

/** What is wrong with the colours the rig holds now: every colour is a token or white, and the cross holds exactly two of them. */
function colourFaults(rig: SceneRig): string[] {
  const faults: string[] = [];
  const need = (what: string, hex: number) => { if (!allowed.includes(hex)) faults.push(`${what} ${hex.toString(16)}`); };
  rig.fixtures.forEach((f, i) => {
    need(`beam ${i}`, uniform(f.beamMaterial.uniforms.uColor));
    need(`beam ${i} from`, uniform(f.beamMaterial.uniforms.uFrom));
    need(`lens ${i}`, f.lensMaterial.color.getHex());
  });
  for (const [i, h] of rig.haze.entries()) { need(`haze ${i}`, uniform(h.material.uniforms.uColor)); need(`haze ${i} from`, uniform(h.material.uniforms.uFrom)); }
  const wall = rig.wall.mesh.instanceColor!.array;
  for (let i = 0; i < wall.length; i += 3 * 13) if (!isHue(new Color().setRGB(wall[i]!, wall[i + 1]!, wall[i + 2]!))) faults.push(`wall dot ${i / 3}`);
  return faults;
}

const scenarios: readonly (readonly [string, FeedOptions, QualityLevel])[] = [
  ["running", {}, "High"], ["reduced motion", { reducedMotion: true }, "High"], ["coasting", { link: { state: "Coasting" } }, "Medium"],
  ["off the list", { link: { state: "Off the list" } }, "High"], ["paused", { link: { state: "Paused" } }, "Low"],
  ["before the start", { stage: "before" }, "High"], ["finished", { stage: "finished" }, "High"],
];

test("S5 and rule 7: on every frame of the class, in every state, each colour is a zone token or white; the front only ever crosses between two", () => {
  for (const [name, options, quality] of scenarios) {
    const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
    let [frames, crossing, flashing] = [0, 0, 0];
    for (let ms = 0, n = 0; ms < 170_000; n++) {
      const d: Draw = loop.step(feedAt(ms, options), n === 0 ? 0 : 1 / 60, quality);
      rig.apply(d, quality);
      assert.deepEqual(colourFaults(rig), [], `${name} at ${ms}`);
      if (d.cross.k < 1) {
        crossing++;
        const [from, to] = [d.cross.from, d.cross.to];
        const zoneAt = (classMs: number) => DEMO_CLASS.intervals.filter((iv) => iv.startMs <= classMs).at(-1)!.zone;
        assert.ok(to.kind === "zone" && to.zone === zoneAt(ms) && from.kind === "zone" && from.zone === zoneAt(ms - 1000 / 60 * 45), `${name} at ${ms}: a cross is from the zone left to the zone in`);
      }
      flashing += d.flash > 0 ? 1 : 0;
      ms += d.dtSeconds * 1000;
      frames++;
    }
    assert.ok(frames > 9000, name);
    if (name === "running") assert.ok(crossing > 250 && flashing > 20, `the run has crosses (${crossing} frames) and flashes (${flashing})`);
    else if (name === "before the start" || name === "finished" || name === "reduced motion") assert.equal(crossing + flashing, 0, name);
  }
});

test("the colour check sees a third hue: a mix of two zones, in a beam, a lens, the haze or the wall, is a fault", () => {
  const mix = new Color(tokens.zones[1]).lerp(new Color(tokens.zones[4]), 0.5);
  const fresh = () => { const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)]; rig.apply(loop.step(feedAt(45_000), 0, "High"), "High"); return rig; };
  assert.deepEqual(colourFaults(fresh()), []);
  const mutations: readonly ((rig: SceneRig) => void)[] = [
    (r) => (r.fixtures[3]!.beamMaterial.uniforms.uColor!.value as Color).copy(mix),
    (r) => (r.fixtures[3]!.beamMaterial.uniforms.uFrom!.value as Color).copy(mix),
    (r) => r.fixtures[3]!.lensMaterial.color.copy(mix),
    (r) => (r.haze[0].material.uniforms.uColor!.value as Color).copy(mix),
    (r) => (r.haze[1].material.uniforms.uFrom!.value as Color).copy(mix),
    (r) => { const a = r.wall.mesh.instanceColor!.array as unknown as number[]; a[0] = mix.r; a[1] = mix.g; a[2] = mix.b; },
  ];
  for (const [i, mutate] of mutations.entries()) { const rig = fresh(); mutate(rig); assert.ok(colourFaults(rig).length > 0, `mutation ${i} went unseen`); }
});

test("reduced motion (S11): no cross, no flash, no burst, no accent, no dim; every colour change is one frame", () => {
  const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
  const hues: string[] = [];
  for (let ms = 0, n = 0; ms < DEMO_CLASS.endMs - 1000; n++) { // the class's end is the finished house, which is not a dim
    const d = loop.step(feedAt(ms, { reducedMotion: true }), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    assert.deepEqual([d.cross.k, d.cross.from, d.flash, d.burst, d.lift, d.sideLight.accent, d.sideLight.level, d.master, d.reduced], [1, d.cross.to, 0, 0, 0, 0, 1, 1, true], `at ${ms}`);
    assert.ok(rig.fixtures.every((f) => (f.beamMaterial.uniforms.uK!.value as number) === 1));
    const hue = JSON.stringify(d.cross.to);
    if (hues.at(-1) !== hue) hues.push(hue);
    ms += d.dtSeconds * 1000;
  }
  assert.ok(hues.length >= 8, "the zones change through the class");
});

test("--m-change and --m-flash of 0 ms (the page's own reduced motion, tokens.css) give no cross and no flash either", () => {
  const instant = { ...tokens, changeMs: 0, flashMs: 0 };
  const loop = new RigLoop(instant);
  for (let ms = 10_000, n = 0; ms < 130_000; n++) {
    const d = loop.step(feedAt(ms), n === 0 ? 0 : 1 / 60, "High");
    assert.deepEqual([d.cross.k, d.flash], [1, 0], `at ${ms}`);
    ms += d.dtSeconds * 1000;
  }
});
