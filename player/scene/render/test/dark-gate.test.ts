// The dark gate (src/dark-gate.ts) on its own, with spans and cuts given: when the beams are dark and the light comes back, a joined span, a burst's
// B7 and B8, a span the song was already in, an unforeseen cause, and what the hold does not follow (a burst).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CutRecord, DarkSpan } from "../../model/src/index.ts";
import { DarkGate } from "../src/dark-gate.ts";

const F = 1000 / 60;
const LEAST = 1000 + F;
/** Within a frame of `x`: the frames are on a 1/60 s grid. */
const at = (v: number, x: number): boolean => Math.abs(v - x) <= F + 1e-6;

/** Plays frames from `from` to `to`; `onTarget(t)` says whether every beam is on its target; returns the frames the beams are dark on and what the hold says. */
function run(spans: DarkSpan[], onTarget: (t: number) => boolean, opts: { from?: number; to?: number; cuts?: CutRecord[]; cause?: { atMs: number } } = {}) {
  const gate = new DarkGate();
  const dark: number[] = [];
  const held: number[] = [];
  for (let t = opts.from ?? 0, n = 0; t < (opts.to ?? 8000); t += F, n++) {
    if (gate.held(t, spans)) held.push(t);
    const cause = opts.cause !== undefined && Math.abs(t - opts.cause.atMs) < F / 2 ? { turnStartMs: t + 2000 } : null;
    if (gate.step({ classMs: t, spans, cuts: opts.cuts ?? [], onTarget: onTarget(t), cause })) dark.push(t);
  }
  return { dark, held, range: (xs: number[]): [number, number] | null => (xs.length === 0 ? null : [xs[0]!, xs.at(-1)!]) };
}
const span = (offMs: number, onMs: number, lastStartMs = offMs, extra: Partial<DarkSpan> = {}): DarkSpan => ({ offMs, onMs, lastStartMs, ...extra });

test("the beams are dark from the off-step until every beam is on target and 1 s + 1 frame have passed, and the first frame is lit", () => {
  const slow = run([span(2000, 5000)], (t) => t >= 5000);
  const [a, b] = slow.range(slow.dark)!;
  assert.ok(at(a, 2000) && at(b, 5000), `dark ${a} to ${b}: lit again on arrival`);
  const quick = run([span(2000, 3017)], () => true);
  const [c, d] = quick.range(quick.dark)!;
  assert.ok(d - c >= LEAST - 2 * F, `arrived at once: still dark for ${d - c} ms, 1 s + 1 frame less a frame`);
  const midSpan = run([span(2000, 5000)], () => true, { from: 3000 });
  assert.equal(midSpan.dark.length, 0, "a span already running when the rig starts was never dark: the beams start on their targets");
});

test("a joined span stays dark through the gap, from the first off-step to the last arrival, though the first turn had arrived", () => {
  // The second turn starts at 2500, under 1 s + 1 frame after the first span's on-step at 2017; the beams are on target until it starts.
  const joined = span(1000, 3600, 2500);
  const onTarget = (t: number) => t < 2500 || t >= 3600;
  const r = run([joined], onTarget);
  const [a, b] = r.range(r.dark)!;
  assert.ok(at(a, 1000), "one off-step");
  assert.ok(at(b, 3600), `and one on-step, after the last arrival (${b})`);
  assert.equal(r.dark.filter((t, i) => i > 0 && t - r.dark[i - 1]! > 2 * F).length, 0, "no light in between");
});

test("B7: the light stays off past the arrival and comes on in the rise frame; B8: the beams go dark in the rise frame and come back 1 s + 1 frame after the decay", () => {
  const b7 = run([span(1000, 2100)], () => true, { cuts: [{ id: "x", planned: { fromMs: 1000, toMs: 2100 }, kind: "b7", offMs: 1000, onMs: 3000 }] });
  const [, end7] = b7.range(b7.dark)!;
  assert.ok(at(end7, 3000), `dark to the rise frame (${end7}), though arrived at 2100`);
  const b8 = run([span(4000, 5100)], (t) => t < 4000 || t >= 5100, { to: 9000, cuts: [{ id: "y", planned: { fromMs: 4000, toMs: 5100 }, kind: "b8", offMs: 3000, onMs: 5100 }] });
  const [start8, end8] = b8.range(b8.dark)!;
  assert.ok(at(start8, 3000), `dark from the rise frame (${start8}), a second before the turn starts`);
  assert.ok(at(end8, 5100), `back at ${end8}`);
});

test("the hold follows the span as planned without any burst: the same with a cut and without, from 1 s before the off-step to 1 s after the on-step", () => {
  const plain = run([span(2000, 3500)], (t) => t >= 3500);
  const cut = run([span(2000, 3500)], (t) => t >= 3500, { cuts: [{ id: "x", planned: { fromMs: 2000, toMs: 3500 }, kind: "b7", offMs: 2000, onMs: 5000 }] });
  assert.deepEqual(cut.held, plain.held, "a burst does not move the hold");
  const [a, b] = plain.range(plain.held)!;
  assert.ok(at(a, 1000), "from 1 s before the off-step");
  assert.ok(Math.abs(b - 4500) <= 2 * F, `to 1 s after the on-step (${b})`);
});

test("an unforeseen cause inside a dark span keeps the beams dark through the 2 s hold and the new turn; one outside starts a dark span 2 s after it", () => {
  const inside = run([span(1000, 2100)], (t) => t < 1500 || t >= 4600, { cause: { atMs: 1500 } });
  const [, end] = inside.range(inside.dark)!;
  assert.ok(end >= 4600 - F - 1e-6, `dark through the hold and the turn that follows it (${end})`);
  const outside = run([], (t) => t < 5000 || t >= 7000, { cause: { atMs: 3000 }, to: 9000 });
  const [s, e] = outside.range(outside.dark)!;
  assert.ok(at(s, 5000), `the new turn starts 2 s after the cause, dark from its first frame (${s})`);
  assert.ok(at(e, 7000), `and is lit when the beams arrive (${e})`);
  assert.equal(outside.dark.filter((t) => t < 5000).length, 0, "no step in the cause's own frame");
});

test("a seek into a planned span does not step the light: the span the song was in before the seek is over for the rig", () => {
  const gate = new DarkGate();
  gate.step({ classMs: 0, spans: [span(10_000, 13_000)], cuts: [], onTarget: true, cause: null });
  const darkAfterSeek = gate.step({ classMs: 11_000, spans: [span(10_000, 13_000)], cuts: [], onTarget: true, cause: { turnStartMs: 13_000 } });
  assert.equal(darkAfterSeek, false, "the beams never went dark in the span it landed in");
});
