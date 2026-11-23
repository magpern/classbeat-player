// The scene changes only on a planned mark (scene.md "The flash budget", #616): in the steady draw, the lit fixtures, the zone's energy and
// colours, and the haze's gain change only in a frame `planMarks` places a mark in. Played at 60 fps over every variant of the demo class,
// locked with the beat, at Tempo only and coasting. A draw that changes on a frame with no mark (a breakdown's end, a merged drop's build
// ending at its own moment instead of its frame) is the defect the steady gate (tools/steady-shots.ts) reports as an unmarked jump.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeIntervals } from "../../model/src/index.ts";
import type { SceneClass } from "../../model/src/index.ts";
import { VARIANTS, feedAt } from "../demo/scenario.ts";
import type { Feed } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { plannedMarkIn } from "../src/frame-marks-calc.ts";
import { steadyOnly } from "../src/steady-calc.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
const STATES = [["locked", false], ["tempo only", true], ["coasting", false]] as const;
const noAnchors = (cls: SceneClass): SceneClass => ({ ...cls, songs: cls.songs.map((s) => ({ ...s, anchors: [] })) });

/** The frames, as class times, at which the steady draw changed with no mark in the frame. */
export function unmarkedChanges(variant: string, state: (typeof STATES)[number], mutate?: (key: string, ms: number) => string): string[] {
  const v = VARIANTS[variant]!;
  const [name, tempo] = state;
  const cls = tempo ? noAnchors(v.cls) : v.cls;
  const link = name === "coasting" ? ({ state: "Coasting" } as const) : ({ state: "Locked" } as const);
  const merged = mergeIntervals(cls);
  const loop = new RigLoop(tokens);
  const bad: string[] = [];
  let [classMs, before, key, gain, prev] = [0, 0, "", 1, 0];
  for (let n = 0; classMs < 160_000; n++) {
    const f: Feed = { ...feedAt(classMs, { link, variant: { cls, starts: v.starts } }) };
    const d = steadyOnly(loop.step(f, n === 0 ? 0 : 1 / 60, "High"));
    const k0 = JSON.stringify([d.lit, d.frame.energy, d.frame.colours.front]);
    const k = mutate ? mutate(k0, classMs) : k0;
    const jumped = n > 0 && (k !== key || Math.abs(d.hazeGain - gain) > 0.005);
    if (jumped && d.heldMark === null && !plannedMarkIn({ cls: merged, classMs, songIndex: f.songIndex, songPosMs: f.songPosMs, level: d.frame.level }, prev, classMs)) bad.push(`${name} ${variant} ${Math.round(classMs)} ms: ${k !== key ? "lit, energy or colour" : "haze gain"}`);
    [before, key, gain, prev] = [classMs, k, d.hazeGain, classMs];
    classMs += d.dtSeconds * 1000;
  }
  void before;
  return bad;
}

test("the lit fixtures, the zone's light and the haze's gain change only on a frame planMarks marks, in every state and variant", () => {
  const all = Object.keys(VARIANTS).flatMap((variant) => STATES.flatMap((state) => unmarkedChanges(variant, state)));
  assert.deepEqual(all, []);
});

test("the check can fail: a fixture that lights one frame off its mark is found", () => {
  // Mutation: the lit set flips at 77.5 s, between two countdown seconds.
  const found = unmarkedChanges("demo", STATES[0], (key, ms) => (ms > 77_500 ? `${key}x` : key));
  assert.equal(found.length, 1);
  assert.match(found[0]!, /locked demo 775\d\d ms/);
});
