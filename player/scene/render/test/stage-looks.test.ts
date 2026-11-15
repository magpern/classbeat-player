// The house looks and the holding look (scene.md "States"): before the start the lights are down to 6 % in
// the first zone's colour with two slow beams, a dark wall and no beat; off the list the movement is halved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { advancePhase, angleBetween, phaseRate } from "../../model/src/index.ts";
import { feedAt } from "../demo/scenario.ts";
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
const num = (rig: SceneRig, name: string) => rig.uniform(name) as number[];

test("before the start: lights down to 6 % in the first zone's colour, two beams, the wall dark, no beat, nothing bursts", () => {
  let frames = 0;
  play({ stage: "before" }, 0, 9_500, (d, rig) => { // the clock is at its start: the first zone, and no anticipation yet
    frames++;
    assert.equal(d.master, tokens.down);
    assert.equal(d.stage, "before");
    assert.equal(d.lit.filter(Boolean).length, 2);
    assert.deepEqual([d.lift, d.chaseStep, d.burst, d.frame.level], [0, null, 0, "None"]);
    assert.equal(rig.uniform("uWallOn"), 0, "the wall is dark");
    assert.equal((rig.uniform("uTokA") as { getHex(): number }).getHex(), tokens.zones[1], "the first zone's colour");
    assert.ok(num(rig, "uBF").every((f) => f === 0), "on every light");
    assert.equal(num(rig, "uBI").filter((v) => v > 0).length, 2, "two beams");
    assert.ok(num(rig, "uBL").every((v) => v <= tokens.down * 0.9 + 1e-9), "lens at the lights-down level");
  });
  assert.ok(frames > 500);
});

test("before the start the beams move at half the zone's speed, and not on the music (no moment, no phrase)", () => {
  const first = new RigLoop(tokens).step(feedAt(0, { stage: "before" }), 1 / 60, "High");
  assert.equal(first.frame.moments.gather || first.frame.moments.fan || first.frame.moments.breakdown, false);
  // The same clock, the same song, no music either way: only the stage differs, so the ratio is the movement scale (pins HALVED_MOVEMENT).
  const travel = (options: FeedOptions) => {
    const loop = new RigLoop(tokens);
    let [sum, prev] = [0, loop.step(feedAt(0, options), 0, "High").drawn];
    for (let n = 0; n < 30; n++) { // the same stretch of phase either way would need the same time: half a second keeps the path short and straight
      const d = loop.step(feedAt(0, options), 1 / 60, "High");
      sum += d.drawn.reduce((a, x, i) => a + angleBetween(prev[i]!, x), 0);
      prev = d.drawn;
    }
    return sum;
  };
  const ratio = travel({ stage: "before" }) / travel({ link: { state: "Coasting" } });
  assert.ok(ratio > 0.45 && ratio < 0.55, `before the start the beams travel ${ratio} of what a running room's do (half)`);
  assert.ok(travel({ stage: "before" }) > 0.5 && travel({ stage: "before" }) < phaseRate(1) * 22, "and they do move");
});

test("stageOf: before is what the shell says, anything else is running (the finished house is #577's)", () => {
  assert.equal(stageOf("before"), "before");
  assert.equal(stageOf(undefined), "running");
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
});

test("before the start nothing bursts or dims, even if the clock is moved over an interval or a song change", () => {
  const [loop, rig] = [new RigLoop(tokens), new SceneRig(tokens)];
  for (const ms of [0, 5_000, 19_900, 20_000, 39_900, 40_000, 59_900, 60_000, 79_900, 80_000, 99_900, 100_000, 119_900, 120_000, 130_000, 20_000]) {
    for (let n = 0; n < 40; n++) {
      const d = loop.step(feedAt(ms + n * 17, { stage: "before" }), 1 / 60, "High");
      rig.apply(d, "High");
      assert.deepEqual([d.burst, d.master], [0, tokens.down], `at ${ms} ms`);
    }
  }
});
