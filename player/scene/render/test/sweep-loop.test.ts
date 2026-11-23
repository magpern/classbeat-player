// The sweeps in the rig's own loop (scene.md "Steady light and sweeps", "The fan's turn follows the drop"): a run wanted just after a phrase
// flip is a step, the energy ramp waits for the window's end, the bursts S6 asserts are all placed in the states it asserts them in, the 58 s
// drop has no fan turn and the 40 s drop's starts 2250 ms after it, and a placed burst changes no beam (rule 4, S7).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SceneClass } from "../../model/src/index.ts";
import { DEMO_CLASS, SONG_STARTS_MS, VARIANTS, feedAt } from "../demo/scenario.ts";
import type { Variant } from "../demo/scenario.ts";
import type { Feed } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
const FRAME = 1 / 60;

function play(make: (ms: number) => Feed, fromMs: number, toMs: number, budgetOff = false): { ms: number; ramp: number; burst: number; drawn: string }[] {
  const loop = new RigLoop(tokens, budgetOff);
  const out: { ms: number; ramp: number; burst: number; drawn: string }[] = [];
  for (let ms = fromMs, i = 0; ms < toMs; i++) {
    const d = loop.step(make(ms), i === 0 ? 0 : FRAME, "High");
    out.push({ ms, ramp: d.energyRamp, burst: d.burst, drawn: JSON.stringify(d.drawn) });
    ms += d.dtSeconds * 1000;
  }
  return out;
}
const withChange = (atMs: number, tempoOnly = false): Variant => {
  const songs = tempoOnly ? DEMO_CLASS.songs.map((s) => ({ bpm: s.bpm, ...(s.moments ? { moments: s.moments } : {}), ...(s.lengthMs ? { lengthMs: s.lengthMs } : {}) })) : DEMO_CLASS.songs;
  const cls: SceneClass = { ...DEMO_CLASS, songs, intervals: [{ startMs: 0, zone: 1 }, { startMs: atMs, zone: 3 }, { startMs: 90_000, zone: 2 }] };
  return { cls, starts: SONG_STARTS_MS };
};
const ramps = (variant: Variant, link: Feed["link"], from: number, to: number): number =>
  play((ms) => feedAt(ms, { link, variant }), from, to).filter((f) => f.ramp > 0).length;

test("a run wanted just after a phrase flip is a step: the energy ramp of a change 1 s after the flip at 16 s is in the change frame, and one after the window has its 42 frames", () => {
  assert.equal(ramps(withChange(17_000), { state: "Locked" }, 15_500, 17_500), 0, "the ramp would start 0.3 s after the flip, inside its window");
  assert.ok(ramps(withChange(17_000, true), { state: "Locked" }, 15_500, 17_500) >= 38, "at Tempo only the beat is known and there is no flip: the ramp runs");
  assert.ok(ramps(withChange(21_000), { state: "Locked" }, 19_500, 21_500) >= 38, "the flip's window ends at 20.15 s: a ramp from 20.3 s has the room");
  assert.equal(ramps(withChange(20_800), { state: "Locked" }, 19_500, 21_500), 0, "a ramp from 20.1 s overlaps the last 50 ms of the window");
  assert.equal(ramps(withChange(38_000), { state: "Locked" }, 36_500, 38_500), 0, "and a gather's window, 36.65 to 39 s, holds one just as well");
});

/** The class times (ms) at which a burst goes up, over a stretch of a variant. */
function bursts(variant: string, from: number, to: number, link: Feed["link"], tempoOnly = false): number {
  const v = tempoOnly ? VARIANTS[`tempo~${variant}`]! : VARIANTS[variant]!;
  const frames = play((ms) => feedAt(ms, { link, variant: v }), from, to);
  return frames.filter((f, i) => f.burst > 0 && (i === 0 || frames[i - 1]!.burst === 0)).length;
}

test("every burst S6 asserts is placed in the states it asserts, and the Beat level and Tempo only skip the ones that share a change with a ramp", () => {
  const locked = { state: "Locked" } as const;
  const coasting = { state: "Coasting" } as const;
  assert.equal(bursts("demo", 38_500, 44_000, coasting), 1, "the 40 s drop, coasting");
  assert.equal(bursts("collide", 38_500, 44_000, coasting), 1, "the drop at 40.4 s in the change's frame, coasting");
  assert.equal(bursts("demo", 54_000, 59_000, locked), 1, "the 58 s drop, locked");
  assert.equal(bursts("demo", 54_000, 59_000, locked, true), 1, "the 58 s drop, Tempo only");
  assert.equal(bursts("demo", 54_000, 59_000, coasting), 1, "the 58 s drop, coasting");
  assert.equal(bursts("demo", 78_500, 83_000, coasting), 1, "the light-only burst at 80 s, coasting");
  assert.equal(bursts("demo", 38_500, 44_000, locked), 0, "the ramp has the room at 40 s: no burst");
  assert.equal(bursts("demo", 78_500, 83_000, locked), 0, "and at 80 s");
});

test("the 58 s drop has no fan turn: its beams hold the gather's aim from 0.65 s after it to the song change; the 40 s drop's fan turn starts at 42.25 s", () => {
  const frames = (from: number, to: number, variant = "demo") => play((ms) => feedAt(ms, { variant: VARIANTS[variant]! }), from, to);
  const held = frames(58_700, 59_990);
  assert.ok(held.length > 70 && held.every((f) => f.drawn === held[0]!.drawn), "the beams do not move after the 58 s drop");
  const fan = frames(40_800, 44_000);
  const turned = fan.findIndex((f) => f.drawn !== fan[0]!.drawn);
  assert.ok(Math.abs(fan[turned]!.ms - 42_250) < 40, `the fan's turn starts at ${fan[turned]!.ms} ms, 2250 ms after the drop`);
  assert.ok(frames(61_000, 62_000).some((f, i, all) => f.drawn !== all[0]!.drawn), "the song change's own turn follows");
});

test("a placed burst changes no beam (rule 4, S7): the beams are drawn the same with every burst placed (budget off) and with the scheduler's own", () => {
  for (const [variant, from, to] of [["demo", 36_000, 62_000], ["collide", 38_500, 44_000], ["demo", 74_000, 83_000]] as const) {
    const run = (budgetOff: boolean) => play((ms) => feedAt(ms, { link: { state: "Coasting" }, variant: VARIANTS[variant]! }), from, to, budgetOff);
    const [off, on] = [run(true), run(false)];
    assert.equal(off.length, on.length);
    assert.ok(off.some((f) => f.burst > 0) && on.some((f) => f.burst > 0), `${variant}: bursts in both`);
    assert.deepEqual(off.map((f) => f.drawn), on.map((f) => f.drawn), `${variant}: no beam differs`);
  }
});
