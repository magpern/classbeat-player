// When the text steps (scene.md text rule 2, S14), through the rig's loop: every text step is a frame mark, any two are at least
// 500 ms apart across both layers, the change frame is at the change, the countdown steps on the interval's seconds, the
// pattern count on the beats, the side step of the beams on the count tick, and a person's action is shown within 500 ms.
import assert from "node:assert/strict";
import { test } from "node:test";
import { VARIANTS, feedAt } from "../demo/scenario.ts";
import type { Variant } from "../demo/scenario.ts";
import type { Feed } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
const FRAME = 1000 / 60;

interface Step { readonly ms: number; readonly shownMs: number; /** How many jumps came before it: the frames of one stretch of the class clock share it. */ readonly seg: number }
interface Played { readonly steps: Step[]; readonly levels: { ms: number; level: number; changed: boolean }[]; readonly lit: { ms: number; n: number }[] }

function play(make: (ms: number) => Feed, from: number, to: number, jumps: readonly { atMs: number; toMs: number }[] = []): Played {
  const loop = new RigLoop(tokens);
  const out: Played = { steps: [], levels: [], lit: [] };
  const due = [...jumps];
  let ms = from;
  let seg = 0;
  for (let n = 0; ms < to; n++) {
    const jump = due.find((j) => j.atMs <= ms);
    if (jump) { due.splice(due.indexOf(jump), 1); ms = jump.toMs; seg++; }
    const d = loop.step(make(ms), 1 / 60, "High");
    if (d.text.changed) out.steps.push({ ms, shownMs: d.text.classMs, seg });
    out.levels.push({ ms, level: d.beamLevel, changed: d.text.changed });
    out.lit.push({ ms, n: d.lit.filter(Boolean).length });
    ms += d.dtSeconds * 1000;
  }
  return out;
}
const variant = (v: Variant, link: Feed["link"] = { state: "Locked" }) => (ms: number) => feedAt(ms, { variant: v, link });
const gapsOf = (steps: readonly Step[]): number[] => steps.slice(1).flatMap((s, i) => (s.seg === steps[i]!.seg ? [s.ms - steps[i]!.ms] : []));

test("on every variant of the demo class, locked and coasting, any two text steps are at least 500 ms apart (to a frame)", () => {
  for (const [name, v] of Object.entries(VARIANTS)) {
    for (const link of [{ state: "Locked" }, { state: "Coasting" }] as const) {
      const { steps } = play(variant(v, link), 0, 160_000);
      const bad = gapsOf(steps).filter((g) => g < 500 - FRAME);
      assert.deepEqual(bad, [], `${name}, ${link.state}`);
      assert.ok(steps.length > 140, `${name}, ${link.state}: ${steps.length} steps in 160 s`);
    }
  }
});

test("the change frame is the frame at the change, and the countdown steps on the interval's own seconds", () => {
  const { steps } = play(variant(VARIANTS.demo!, { state: "Coasting" }), 18_000, 26_000);
  const near = (s: number) => steps.some((x) => x.ms >= s && x.ms < s + FRAME + 1e-6);
  assert.ok(near(20_000), "the change at 20 s");
  for (const s of [21_000, 22_000, 23_000, 24_000, 25_000]) assert.ok(near(s), `the tick at ${s}`);
  assert.equal(steps.filter((x) => x.ms > 20_100 && x.ms < 20_900).length, 0, "nothing between");
  assert.ok(steps.every((x) => x.shownMs === x.ms), "a step shows the class as it is on its frame, never a time ahead");
});

test("the text holds what the last mark showed: between two marks its time does not move", () => {
  const loop = new RigLoop(tokens);
  let held: number | null = null;
  for (let ms = 30_000; ms < 34_000; ms += FRAME) {
    const t = loop.step(feedAt(ms), ms === 30_000 ? 0 : 1 / 60, "High").text;
    if (t.changed) held = t.classMs;
    else assert.equal(t.classMs, held, `at ${ms}`);
  }
});

test("a count at 100 bpm steps on every beat, 600 ms apart, and the side's step is on the count tick that shows it", () => {
  const p = play(variant(VARIANTS.demo!), 122_000, 142_000);
  const ticks = p.steps.filter((s) => s.ms > 122_500 && s.ms < 139_000);
  assert.ok(gapsOf(ticks).every((g) => g > 590 && g < 625), "one a beat");
  // The beams' level steps (100 % to 72 % and back at 124.6 s and 129.4 s: the 33rd beat is the first counted one) only on a text step.
  const stepped = p.levels.filter((l, i) => i > 0 && l.level !== p.levels[i - 1]!.level);
  assert.ok(stepped.length >= 2, `${stepped.length} side steps`);
  assert.ok(stepped.every((l) => l.changed), "a side's step never falls between ticks");
  const first = stepped[0]!;
  assert.ok(first.ms >= 124_600 && first.ms < 124_600 + 2 * FRAME, `the first side step at ${first.ms}`);
});

test("a person's action is shown within 500 ms: a pause, a resume and a seek", () => {
  const events = (ms: number): Feed["link"] => (ms >= 70_000 && ms < 71_200 ? { state: "Paused" } : { state: "Locked" });
  const loop = new RigLoop(tokens);
  const shown: { ms: number; state: string }[] = [];
  for (let ms = 68_500; ms < 73_000; ms += FRAME) {
    const link = events(ms);
    const t = loop.step({ ...feedAt(ms), link }, 1 / 60, "High").text;
    if (t.changed) shown.push({ ms, state: t.link.state });
  }
  const paused = shown.find((s) => s.state === "Paused");
  const resumed = shown.find((s) => s.ms > 71_000 && s.state === "Locked");
  assert.ok(paused !== undefined && paused.ms - 70_000 <= 500 + FRAME, `the pause shown at ${paused?.ms}`);
  assert.ok(resumed !== undefined && resumed.ms - 71_200 <= 500 + FRAME, `the resume shown at ${resumed?.ms}`);
  assert.ok(gapsOf(shown.map((s) => ({ ms: s.ms, shownMs: s.ms, seg: 0 }))).every((g) => g >= 500 - FRAME), "and still 500 ms apart");
  const p = play(variant(VARIANTS.demo!), 18_500, 23_000, [{ atMs: 20_500, toMs: 19_000 }]);
  assert.ok(gapsOf(p.steps).every((g) => g >= 500 - FRAME), "a seek back across the change at 20 s: 500 ms apart");
  const landed = p.steps.find((s) => s.seg === 1);
  assert.ok(landed !== undefined && landed.ms - 19_000 <= 500 + 2 * FRAME, `the new position is shown within 500 ms of the seek (at ${landed?.ms})`);
});

test("the fan's fixtures come on in the drop's frame: a drop 0.4 s after an interval change lights the rig at the change frame, the beams' turn stays on the drop", () => {
  const p = play(variant(VARIANTS.collide!), 39_000, 41_500);
  const litAt = (s: number) => p.lit.find((l) => l.ms >= s)!.n;
  assert.ok(litAt(39_900) < 22, "not before the change frame");
  assert.equal(litAt(40_050), 22, "the whole rig is lit from the change frame, 0.4 s before the drop's moment");
  assert.equal(litAt(41_000), 22, "and stays lit through the fan");
});
