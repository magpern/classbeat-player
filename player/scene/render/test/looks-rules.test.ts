// The product rules on the stage looks and the halved movement, rule-sensitive: S5 and rule 7 (the shader is
// given only zone tokens, one per light, on every frame, in every state) and reduced motion (S11: no burst, no
// dim, no cross, colour changes at once). The rendered pixels are checked in the browser run (tools/s5-fit.ts).
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

/** What is wrong with what the shader is given now: both tokens are zone tokens or white, and every light carries one of them whole. */
function faults(rig: SceneRig): string[] {
  const out: string[] = [];
  for (const name of ["uTokA", "uTokB"]) if (!allowed.includes((rig.uniform(name) as Color).getHex())) out.push(name);
  if (!rig.tokenFlags().every((f) => f === 0 || f === 1)) out.push("a light carries a share of a token");
  return out;
}

const scenarios: readonly (readonly [string, FeedOptions, QualityLevel])[] = [
  ["running", {}, "High"], ["reduced motion", { reducedMotion: true }, "High"], ["coasting", { link: { state: "Coasting" } }, "Medium"],
  ["off the list", { link: { state: "Off the list" } }, "High"], ["paused", { link: { state: "Paused" } }, "Low"],
  ["before the start", { stage: "before" }, "High"],
];

test("S5 and rule 7: on every frame of the class, in every state, the shader holds zone tokens only, one per light", () => {
  for (const [name, options, quality] of scenarios) {
    const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
    let frames = 0;
    for (let ms = 0, n = 0; ms < 170_000; n++) {
      const d: Draw = loop.step(feedAt(ms, options), n === 0 ? 0 : 1 / 60, quality);
      rig.apply(d, quality);
      assert.deepEqual(faults(rig), [], `${name} at ${ms}`);
      ms += d.dtSeconds * 1000;
      frames++;
    }
    assert.ok(frames > 9000, name);
  }
});

test("the check sees a third hue: a mix of two zones as a token, or a share of a token on a light, is a fault", () => {
  const mix = new Color(tokens.zones[1]).lerp(new Color(tokens.zones[4]), 0.5);
  const fresh = () => { const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)]; rig.apply(loop.step(feedAt(35_000), 0, "High"), "High"); return rig; };
  assert.deepEqual(faults(fresh()), []);
  const [a, b, c] = [fresh(), fresh(), fresh()];
  (a.uniform("uTokA") as Color).copy(mix);
  (b.uniform("uTokB") as Color).copy(mix);
  (c.uniform("uBP") as number[])[3 * 4 + 2] = 0.5;
  for (const rig of [a, b, c]) assert.ok(faults(rig).length > 0);
});

test("reduced motion (S11): no burst, no dim, no lift, no cross; every colour change is one frame", () => {
  const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
  const hues: string[] = [];
  for (let ms = 0, n = 0; ms < 170_000; n++) {
    const d = loop.step(feedAt(ms, { reducedMotion: true }), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    assert.deepEqual([d.burst, d.lift, d.master, d.reduced, d.cross.front, d.cross.ramp], [0, 0, 1, true, 2, 0], `at ${ms}`);
    const hue = JSON.stringify(d.tokens.current);
    if (hues.at(-1) !== hue) hues.push(hue);
    ms += d.dtSeconds * 1000;
  }
  assert.ok(hues.length >= 8, "the zones change through the class");
});
