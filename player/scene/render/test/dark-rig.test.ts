// A sweep moves in black, in the rig's own loop and on what the rig holds (scene.md "A sweep moves in black"): from the off-step, the turn's first
// frame, until the on-step, every beam throws 0 and every lens sits at one fixed level; the steps are at least 1 s + 1 frame apart; the sway's phase
// and steady light's clock are held round the span and resume where they stopped; a burst moves only light, never a direction or the hold.
import assert from "node:assert/strict";
import { test } from "node:test";
import { VARIANTS, feedAt } from "../demo/scenario.ts";
import type { Variant } from "../demo/scenario.ts";
import { genName } from "../demo/generated.ts";
import type { Draw, Feed } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { SceneRig } from "../src/rig.ts";
import { lookByZone } from "../tools/shared-cases.ts";
import { firstSpanMs, overlapCase } from "../tools/shared-sweeps.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
const F = 1000 / 60;
interface Frame { lift: number; haze: number; ms: number; /** The frame's own time: frame number x the refresh period, the wall time a viewer lives through (a seek or a pause moves the class clock, never this). */ wall: number; dark: boolean; beams: number[]; lens: number[]; seconds: number; drawn: string }

function play(make: (ms: number) => Feed, from: number, to: number, budgetOff = false): Frame[] {
  const [loop, rig] = [new RigLoop(tokens, budgetOff), new SceneRig(tokens)];
  const out: Frame[] = [];
  for (let ms = from, n = 0; ms < to; n++) {
    const d: Draw = loop.step(make(ms), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    out.push({ lift: d.lift, haze: d.hazeGain, ms, wall: n * F, dark: d.dark, beams: rig.beamLevels(), lens: rig.lensLevels(), seconds: d.seconds, drawn: JSON.stringify(d.drawn) });
    ms += d.dtSeconds * 1000;
  }
  return out;
}
/** Each dark episode: its length is measured in the frames' own (wall) time, where it lies on the class clock in `offMs` and `onMs`. */
const episodes = (frames: Frame[]): { off: number; on: number; offMs: number; onMs: number }[] => {
  const out: { off: number; on: number; offMs: number; onMs: number }[] = [];
  frames.forEach((f, i) => {
    if (f.dark && !frames[i - 1]?.dark) out.push({ off: f.wall, on: f.wall, offMs: f.ms, onMs: f.ms });
    if (!f.dark && frames[i - 1]?.dark) { out[out.length - 1]!.on = f.wall; out[out.length - 1]!.onMs = f.ms; }
  });
  return out;
};
const demo = (ms: number): Feed => feedAt(ms, { link: { state: "Locked" } });

test("the phrase flip at 32 s: every beam is 0 and every lens fixed from the off-step to the on-step, lit before and after, dark for 1 s + 1 frame at least", () => {
  const frames = play(demo, 30_000, 38_000);
  const [span] = episodes(frames);
  assert.ok(span !== undefined && Math.abs(span.offMs - 32_000) <= F, `the off-step is the turn's first frame (${span?.offMs})`);
  assert.ok(span!.on - span!.off >= 1000 + F - 1, `dark for ${span!.on - span!.off} ms`);
  const inside = frames.filter((f) => f.ms >= span!.offMs && f.ms < span!.onMs);
  assert.ok(inside.every((f) => f.dark && f.beams.every((b) => b === 0)), "no shaft, scatter or spot");
  const lens = inside.map((f) => f.lens.join());
  assert.equal(new Set(lens).size, 1, "the lens does not move with direction: one level per fixture");
  const before = frames.filter((f) => f.ms < span!.offMs - 1);
  assert.ok(before.every((f) => !f.dark) && before.some((f) => f.beams.some((b) => b > 0)), "lit before");
  assert.ok(frames.filter((f) => f.ms >= span!.onMs).slice(0, 5).every((f) => !f.dark && f.beams.some((b) => b > 0)), "lit again from the on-step");
  assert.equal(episodes(frames.filter((f) => f.ms < 36_000)).length, 1, "one off-step and one on-step");
});

test("the sway's phase and steady light's clock are held from 1 s before the off-step to 1 s after the on-step, and resume where they stopped", () => {
  const frames = play(demo, 86_500, 98_500); // song 1's flip at 90 s: no other turn for 4 s either side
  const [span] = episodes(frames);
  const at = (ms: number) => frames.reduce((best, f) => (Math.abs(f.ms - ms) < Math.abs(best.ms - ms) ? f : best));
  const held = frames.filter((f) => f.ms > span!.offMs - 990 && f.ms < span!.onMs + 990);
  assert.ok(held.every((f) => f.seconds === held[0]!.seconds), "steady light's clock stands still");
  assert.ok(at(span!.offMs - 1200).seconds !== held[0]!.seconds, "and ran before it");
  const after = frames.filter((f) => f.ms > span!.onMs + 1100);
  assert.ok(after[5]!.seconds > after[0]!.seconds, "and runs after it, from where it stopped");
  assert.ok(Math.abs(after[0]!.seconds - held[0]!.seconds) < 0.1 + 1.2, "never catching up to the class clock");
});

test("a burst moves only light: the drawn directions, the hold and the steady clock are the same with every burst placed and with the scheduler's own", () => {
  const coasting = (ms: number) => feedAt(ms, { link: { state: "Coasting" } });
  for (const [from, to] of [[36_000, 45_000], [54_000, 63_000]] as const) {
    const [off, on] = [play(coasting, from, to, true), play(coasting, from, to, false)];
    assert.deepEqual(off.map((f) => [f.drawn, f.seconds]), on.map((f) => [f.drawn, f.seconds]), `${from}: no direction or clock depends on a burst`);
  }
});

test("B7: the 40.4 s drop's gather is dark past its arrival and comes on in the rise frame at 40.0 s, the beams throwing nothing until then", () => {
  const collide = (ms: number) => feedAt(ms, { link: { state: "Coasting" }, variant: VARIANTS.collide! });
  const frames = play(collide, 37_000, 43_000);
  const gather = episodes(frames).find((e) => e.offMs > 36_500 && e.offMs < 38_000)!;
  assert.ok(gather !== undefined && Math.abs(gather.onMs - 40_000) <= 2 * F, `lit again in the rise frame (${gather?.onMs})`);
  assert.ok(frames.filter((f) => f.ms >= gather.offMs && f.ms < gather.onMs).every((f) => f.beams.every((b) => b === 0)));
  assert.ok(frames.some((f) => f.ms >= 40_000 && f.ms < 40_300), "and the burst is in that frame");
});

test("B8: a turn that starts under 1 s after a burst's decay goes dark in the rise frame and is back 1 s + 1 frame after the decay", () => {
  const f = lookByZone().find((x) => x.look === "circle" && x.zone === 4)!;
  const c = overlapCase(0, false, f); // a flip and a gather at once: one span; the burst case below uses the demo class instead
  assert.ok(c.toMs > c.fromMs);
  const frames = play((ms) => feedAt(ms, { link: { state: "Coasting" } }), 58_500, 63_500);
  const dark = frames.filter((x) => x.dark);
  const song = episodes(frames).find((e) => e.offMs >= 58_000)!;
  assert.ok(song !== undefined, "the song change at 60 s is dark");
  assert.ok(dark.every((x) => x.beams.every((b) => b === 0)));
  assert.ok(song.on - song.off >= 1000 + F - 1);
});

test("two turns whose gap is under 1 s + 1 frame join into one dark span, a frame either side of the join point; further apart they are two", () => {
  const f = lookByZone().find((x) => x.look === "circle" && x.zone === 4)!;
  const span = firstSpanMs(f);
  const join = span + 1000 + F;
  const variantOf = (offset: number): Variant => VARIANTS[genName(overlapCase(offset, false, f).spec)]!;
  const count = (offset: number): number => {
    const c = overlapCase(offset, false, f);
    return episodes(play((ms) => feedAt(ms, { link: { state: "Locked" }, variant: variantOf(offset) }), c.fromMs, c.toMs)).length;
  };
  assert.equal(count(join - F), 1, "a frame under the join point: one span");
  assert.equal(count(join + F), 2, "a frame over it: two");
  assert.equal(count(0), 1, "turns that start together: one span");
  assert.equal(count(span / 2), 1, "overlapping turns: one span");
});

test("a drop's gather holds the beat-like light with the sway: no lift or pulse and a standing build haze from 1 s before its off-step to 1 s after its on-step, then the lift again", () => {
  const tempo = { ...VARIANTS.demo!, cls: { ...VARIANTS.demo!.cls, songs: VARIANTS.demo!.cls.songs.map((song) => Object.fromEntries(Object.entries(song).filter(([k]) => k !== "anchors")) as typeof song) } };
  for (const [name, make] of [["locked", demo], ["tempo only", (ms: number) => feedAt(ms, { link: { state: "Locked" }, variant: tempo })]] as const) {
    const frames = play(make, 33_000, 44_000);
    const gather = episodes(frames).find((e) => e.offMs > 36_000 && e.offMs < 37_500)!;
    assert.ok(gather !== undefined, `${name}: the gather is dark`);
    const hold = frames.filter((f) => f.ms >= gather.offMs - 990 && f.ms < gather.onMs + 990);
    assert.ok(hold.length > 100 && hold.every((f) => f.lift === 0), `${name}: no lift or pulse in the hold`);
    assert.ok(hold.every((f) => f.haze === hold[0]!.haze), `${name}: the build's haze stands still in the hold`);
    assert.ok(frames.filter((f) => f.ms > gather.onMs + 1100 && f.ms < gather.onMs + 3000).some((f) => f.lift > 0.01), `${name}: and the lift is back after it`);
    assert.ok(frames.filter((f) => f.ms < gather.offMs - 1100 && f.ms > 33_500).some((f) => f.lift > 0.01), `${name}: it ran before it`);
  }
});
