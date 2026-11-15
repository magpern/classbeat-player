// The house looks and the holding look (scene.md "States"): before the start the lights are down to 6 % in
// the first zone's colour with two slow beams, a dark wall and no beat; when finished the house lights
// come up, the rig white and still at 40 %, the wall white; off the list the movement is halved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color } from "three";
import { QUALITY, advancePhase, angleBetween, phaseRate } from "../../model/src/index.ts";
import { DEMO_CLASS, feedAt } from "../demo/scenario.ts";
import type { FeedOptions } from "../demo/scenario.ts";
import type { Draw } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { SceneRig } from "../src/rig.ts";
import { stageOf } from "../src/stage-calc.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
function play(options: FeedOptions, fromMs: number, toMs: number, each?: (d: Draw, rig: SceneRig) => void): { loop: RigLoop; rig: SceneRig } {
  const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
  for (let ms = fromMs, n = 0; ms < toMs; n++) {
    const d = loop.step(feedAt(ms, options), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    each?.(d, rig);
    ms += d.dtSeconds * 1000;
  }
  return { loop, rig };
}
const lensHexes = (rig: SceneRig) => rig.fixtures.map((f) => f.lensMaterial.color.getHex());

test("before the start: lights down to 6 % in the first zone's colour, two beams, the wall dark, no beat, nothing bursts", () => {
  let frames = 0;
  play({ stage: "before" }, 0, 9_500, (d, rig) => { // the clock is at its start: the first zone, and no anticipation yet
    frames++;
    assert.equal(d.master, tokens.down);
    assert.equal(d.stage, "before");
    assert.equal(d.lit.filter(Boolean).length, 2);
    assert.deepEqual([d.lift, d.chaseStep, d.burst, d.flash, d.frame.level], [0, null, 0, 0, "None"]);
    assert.equal(rig.wall.mesh.visible, false, "the wall is dark");
    assert.ok(rig.fixtures.every((f) => f.beamMaterial.uniforms.uColor!.value.getHex() === tokens.zones[1]), "the first zone's colour on every beam");
    assert.equal(rig.haze[0].material.uniforms.uColor!.value.getHex(), tokens.zones[1]);
    assert.ok(rig.fixtures.every((f) => f.lensMaterial.opacity <= tokens.down * 0.9 + 1e-9), "lens at the lights-down level");
  });
  assert.ok(frames > 500);
});

test("before the start the beams move, slowly, on the first zone's row and not on the music (no moment, no phrase)", () => {
  const { loop } = play({ stage: "before" }, 0, 30_000);
  const first = loop.step(feedAt(0, { stage: "before" }), 1 / 60, "High");
  assert.equal(first.frame.moments.gather || first.frame.moments.fan || first.frame.moments.breakdown, false);
  const [a, b] = [new RigLoop(tokens), new RigLoop(tokens)];
  let travelled = 0;
  let prev = a.step(feedAt(0, { stage: "before" }), 0, "High").drawn;
  for (let n = 0; n < 600; n++) {
    const d = a.step(feedAt(0, { stage: "before" }), 1 / 60, "High");
    travelled += Math.max(...d.drawn.map((x, i) => angleBetween(prev[i]!, x)));
    prev = d.drawn;
    b.step(feedAt(0), 1 / 60, "High");
  }
  assert.ok(travelled > 5 && travelled < phaseRate(1) * 10, `moves slowly: ${travelled} degrees in 10 s`);
});

test("finished: the house lights up, the rig white and still at 40 %, every fixture lit, the wall white and flat; no burst, no flash, no beat", () => {
  const white = new Color().setHex(tokens.white);
  for (const options of [{ stage: "finished" as const }, {}]) {
    const from = options.stage ? 140_000 : DEMO_CLASS.endMs - 1000; // the class's own end on the clock is finished too
    let [before, finishedFrames]: [string | null, number] = [null, 0];
    play(options, from, DEMO_CLASS.endMs + 9000, (d, rig) => {
      if (d.stage !== "finished") return;
      finishedFrames++;
      assert.equal(d.master, tokens.house);
      assert.equal(tokens.house, 0.4);
      assert.equal(d.lit.every(Boolean), true);
      assert.deepEqual([d.lift, d.chaseStep, d.burst, d.flash, d.frame.level, d.reduced], [0, null, 0, 0, "None", true]);
      assert.ok(rig.fixtures.every((f) => f.beamMaterial.uniforms.uColor!.value.getHex() === tokens.white && f.lensMaterial.color.getHex() === tokens.white));
      assert.equal(rig.haze[0].material.uniforms.uColor!.value.getHex(), tokens.white);
      const colours = rig.wall.mesh.instanceColor!.array;
      for (let i = 0; i < colours.length; i += 3 * 41) {
        const m = Math.max(colours[i]!, colours[i + 1]!, colours[i + 2]!);
        assert.ok(m > 0 && [0, 1, 2].every((c) => Math.abs(colours[i + c]! / m - [white.r, white.g, white.b][c]! / Math.max(white.r, white.g, white.b)) < 1e-3), "the wall is white");
      }
      if (finishedFrames < 240) return; // coming to rest takes at most the 3.5 s a turn takes ('How a beam turns')
      const shot = JSON.stringify([rig.measuredDirections(), rig.wall.mesh.instanceColor!.array.slice(0, 30)]);
      before ??= shot;
      assert.equal(shot, before, "and still: nothing moves or changes");
    });
    assert.notEqual(before, null);
    assert.ok(finishedFrames > 400);
  }
  assert.equal(stageOf(DEMO_CLASS, DEMO_CLASS.endMs, undefined), "finished");
  assert.equal(stageOf(DEMO_CLASS, 100, undefined), "running");
  assert.equal(stageOf(DEMO_CLASS, 100, "before"), "before");
});

test("finished and before keep to the quality level: Medium lights 16 of 22 when finished", () => {
  const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
  const d = loop.step(feedAt(30_000, { stage: "finished" }), 0, "Medium");
  rig.apply(d, "Medium");
  assert.equal(d.lit.filter(Boolean).length, QUALITY.Medium.fixtures);
});

test("off the list the movement is halved: the phase advances at half the zone's row, and the beams travel half as far", () => {
  assert.equal(advancePhase(0, 10, 4, 0.5), phaseRate(4) * 10 * 0.5);
  assert.equal(advancePhase(0, 10, 4), phaseRate(4) * 10);
  assert.equal(advancePhase(0, 10, 4, 3), phaseRate(4) * 10, "a scale above 1 never speeds it up");
  assert.equal(advancePhase(0, 10, 4, -1), 0);
  assert.equal(advancePhase(0, 10, 4, Number.NaN), phaseRate(4) * 10);
  const travel = (options: FeedOptions) => {
    const loop = new RigLoop(tokens);
    let [sum, prev] = [0, null as readonly { pan: number; tilt: number }[] | null];
    for (let ms = 62_000, n = 0; ms < 79_000; n++) { // zone 5 in the song with no moments: no gather, fan or burst either way
      const d = loop.step(feedAt(ms, options), n === 0 ? 0 : 1 / 60, "High");
      if (prev && ms > 66_000) sum += d.drawn.reduce((a, x, i) => a + angleBetween(prev![i]!, x), 0);
      prev = d.drawn;
      ms += d.dtSeconds * 1000;
    }
    return sum;
  };
  const ratio = travel({ link: { state: "Off the list" } }) / travel({ link: { state: "Coasting" } });
  assert.ok(ratio > 0.45 && ratio < 0.55, `off the list: ${ratio} of the coasting travel`);
  assert.equal(lensHexes(new SceneRig(tokens)).length, 22);
});
