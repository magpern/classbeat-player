// A sweep moves in black (scene.md "A sweep moves in black", "A burst cuts a sweep's window"): the spans, their joins at 1 s + 1 frame and a frame
// each side of it, chains of three, the hold around them, and what a placed burst does to one (B7 and B8, at 0.1, 0.5 and 0.9 s and at the edges).
import assert from "node:assert/strict";
import { test } from "node:test";
import { HOLD_AROUND_MS, cutSpan, holdAround, minDarkMs, planSpans } from "../src/dark.ts";

const F = 1000 / 60;
const LEAST = minDarkMs(F);
const turn = (startMs: number, arrivalMs = startMs + 1) => ({ startMs, arrivalMs });
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test("a span is dark for at least 1 s + 1 frame: the on-step is the later of the arrival and the off-step plus that", () => {
  assert.ok(near(LEAST, 1000 + F));
  const [quick] = planSpans([turn(10_000, 10_300)], F);
  assert.ok(near(quick!.offMs, 10_000) && near(quick!.onMs, 10_000 + LEAST), "arrived in 0.3 s: still dark for 1 s + 1 frame");
  const [slow] = planSpans([turn(10_000, 13_000)], F);
  assert.ok(near(slow!.onMs, 13_000), "arrived in 3 s: back on arrival");
  const [capped] = planSpans([{ startMs: 10_000, arrivalMs: 13_000, capMs: 12_000 }], F);
  assert.ok(near(capped!.onMs, 12_000) && near(capped!.forceOnMs ?? 0, 12_000), "a gather's light is back at its hold-still, on target or not");
  assert.deepEqual(holdAround({ offMs: 10_000, onMs: 12_000 }), { fromMs: 10_000 - HOLD_AROUND_MS, toMs: 12_000 + HOLD_AROUND_MS });
});

test("near turns join at 1 s + 1 frame: a gap under it joins, at it stays apart, a frame either side of the join point", () => {
  const first = turn(10_000, 12_000); // on-step at 12 000
  for (const [gap, joined] of [[LEAST - 2 * F, true], [LEAST - F, true], [LEAST - 1, true], [LEAST, false], [LEAST + 1, false], [LEAST + F, false], [LEAST + 2 * F, false], [0, true], [-500, true]] as const) {
    const spans = planSpans([first, turn(12_000 + gap, 12_000 + gap + 500)], F);
    assert.equal(spans.length, joined ? 1 : 2, `a gap of ${gap.toFixed(2)} ms ${joined ? "joins" : "stays apart"}`);
    if (joined) assert.ok(near(spans[0]!.offMs, 10_000) && spans[0]!.onMs >= 12_000 + gap + LEAST - 1e-6 - (gap < 0 ? 0 : 0) && spans[0]!.lastStartMs === 12_000 + gap, "one off-step, one on-step after the last turn");
    else assert.ok(spans[1]!.offMs - spans[0]!.onMs >= LEAST - 1e-6, "spans that stay apart have their steps 1 s + 1 frame apart");
  }
});

test("joins chain across three or more spans, each join measured from the span so far", () => {
  const gaps = [LEAST - F, LEAST - F, LEAST - F, LEAST - F]; // each next turn starts just under 1 s + 1 frame after the span's on-step
  const turns = [turn(10_000)];
  let on = 10_000 + LEAST;
  for (const g of gaps) { turns.push(turn(on + g)); on = on + g + LEAST; }
  const spans = planSpans(turns, F);
  assert.equal(spans.length, 1, "five turns, one span");
  assert.ok(near(spans[0]!.offMs, 10_000) && near(spans[0]!.onMs, on));
  const apart = planSpans([...turns, turn(on + LEAST)], F);
  assert.equal(apart.length, 2, "a sixth a full 1 s + 1 frame after stays its own span");
  const early = planSpans([turn(10_000, 14_000), turn(11_000), turn(13_900), turn(15_000)], F);
  assert.equal(early.length, 1, "overlaps share one span too");
  assert.ok(near(early[0]!.onMs, 15_000 + LEAST) || early[0]!.onMs >= 14_000);
  const order = planSpans([turn(15_000), turn(10_000, 14_000), turn(13_900), turn(11_000)], F);
  assert.deepEqual(order, early, "the plan does not depend on the order the turns are given in");
});

test("no 1 s window holds two steps: the steps of the spans of any set of turns are at least 1 s + 1 frame apart", () => {
  let seed = 7;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let k = 0; k < 300; k++) {
    const turns = Array.from({ length: 1 + Math.floor(next() * 8) }, () => { const s = next() * 20_000; return turn(s, s + next() * 3500); });
    const spans = planSpans(turns, F);
    const steps = spans.flatMap((s) => [s.offMs, s.onMs]).sort((a, b) => a - b);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i]! - steps[i - 1]! >= LEAST - 1e-6, `case ${k}: steps ${steps[i - 1]} and ${steps[i]} share a 1 s window`);
    for (const s of spans) assert.ok(s.onMs - s.offMs >= LEAST - 1e-6, "dark for 1 s + 1 frame at least");
    for (const t of turns) assert.ok(spans.some((s) => s.offMs <= t.startMs + 1e-6 && t.startMs <= s.lastStartMs + 1e-6), "every turn starts inside a span, on its own frame");
  }
});

const DECAY = { fromMs: 80_017, toMs: 80_250 };

test("B7: a span whose on-step would come under 1 s + 1 frame before the decay's first frame comes on in the rise frame, 0.1, 0.5, 0.9 s and at the edge", () => {
  const rise = DECAY.fromMs - F;
  for (const gap of [100, 500, 900, LEAST - 1, F]) {
    const c = cutSpan({ offMs: 75_000, onMs: DECAY.fromMs - gap }, DECAY, F);
    assert.equal(c.kind, "b7", `${gap} ms before the decay`);
    assert.ok(c.kind === "b7" && near(c.onMs, rise), "the on-step goes into the rise frame");
  }
  assert.equal(cutSpan({ offMs: 75_000, onMs: DECAY.fromMs - LEAST }, DECAY, F).kind, "clear", "exactly 1 s + 1 frame before: clear");
  assert.equal(cutSpan({ offMs: 75_000, onMs: DECAY.fromMs - LEAST - 1 }, DECAY, F).kind, "clear");
  assert.equal(cutSpan({ offMs: 75_000, onMs: rise }, DECAY, F).kind, "b7", "on in the rise frame itself");
  for (const on of [rise + 1, DECAY.fromMs, DECAY.fromMs + 100, 80_300]) assert.equal(cutSpan({ offMs: 75_000, onMs: on }, DECAY, F).kind, "overlaps", `an on-step ${on} inside the decay: the burst is skipped`);
  assert.equal(cutSpan({ offMs: 80_100, onMs: 82_000 }, DECAY, F).kind, "overlaps", "a span that holds the decay");
});

test("B8: a turn that starts under 1 s after the decay's last frame goes dark in the rise frame and is back 1 s + 1 frame after the decay; 1 s after is clear", () => {
  const rise = DECAY.fromMs - F;
  for (const gap of [0, 100, 500, 900, 999]) {
    const c = cutSpan({ offMs: DECAY.toMs + gap, onMs: DECAY.toMs + gap + LEAST }, DECAY, F);
    assert.equal(c.kind, "b8", `${gap} ms after the decay`);
    assert.ok(c.kind === "b8" && near(c.offMs, rise) && near(c.onMs, DECAY.toMs + gap + LEAST), "dark from the rise frame, on 1 s + 1 frame after the decay's last frame or when its own 1 s + 1 frame is up, the later");
  }
  const late = cutSpan({ offMs: DECAY.toMs + 500, onMs: DECAY.toMs + 4_000 }, DECAY, F);
  assert.ok(late.kind === "b8" && near(late.onMs, DECAY.toMs + 4_000), "back at the later of the arrival and 1 s + 1 frame after the decay");
  assert.equal(cutSpan({ offMs: DECAY.toMs + 1000, onMs: DECAY.toMs + 3_000 }, DECAY, F).kind, "clear");
  assert.equal(cutSpan({ offMs: DECAY.toMs + 1001, onMs: DECAY.toMs + 3_000 }, DECAY, F).kind, "clear");
});
