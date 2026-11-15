// Scope item 2, worst-case drive. For each fixture the model is driven through every step of S7's
// list (a phrase flip, a look change from a mirrored phrase, the gather and the fan switching on
// and off), each from several phases of the motion, at 30, 60 and 144 frames a second. On every
// frame the angle between two consecutive drawn directions over the frame time is at most 30
// degrees a second, and every drawn direction is at its target within 3.5 s plus one frame. The
// drive also has stalled frames of 250 ms and 1 s, which the clamp turns into 100 ms. The drive
// runs `stepRig`, the renderer's own per-frame step, and `turnToward`, its limiter stage.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURES, beamDirection } from "../src/beams.ts";
import type { Direction } from "../src/beams.ts";
import { phraseOfIndex } from "../src/beat-grid.ts";
import { MAX_DEG_PER_SECOND } from "../src/energy.ts";
import { LOOKS } from "../src/looks.ts";
import type { Look } from "../src/looks.ts";
import { NO_MOMENTS } from "../src/moments.ts";
import type { Moments } from "../src/moments.ts";
import { START_STATE, stepRig, turnToward } from "../src/step.ts";
import type { RigState } from "../src/step.ts";
import { angleBetween } from "../src/turn.ts";
import { classA } from "./fixtures.ts";

const FPS = [30, 60, 144] as const;
const PHASES = [0, 60, 120, 180, 240, 300];
const GATHER: Moments = { ...NO_MOMENTS, gather: true };
const FAN: Moments = { ...NO_MOMENTS, fan: true };
const SLACK = 1.000001; // rounding of the speed, not a tolerance on the rule
const REACH_S = 3.5;

interface Shape { readonly look: Look; readonly phrase: number; readonly moments: Moments }
interface Transition { readonly name: string; readonly from: Shape; readonly to: Shape }

function transitions(): Transition[] {
  const out: Transition[] = [];
  for (const look of LOOKS) {
    for (let p = 0; p < 4; p++) out.push({ name: `${look} phrase ${p} to ${p + 1}`, from: { look, phrase: p, moments: NO_MOMENTS }, to: { look, phrase: p + 1, moments: NO_MOMENTS } });
    const next = LOOKS[(LOOKS.indexOf(look) + 1) % LOOKS.length]!;
    for (const p of [1, 3]) out.push({ name: `${look} to ${next} from a mirrored phrase`, from: { look, phrase: p, moments: NO_MOMENTS }, to: { look: next, phrase: 0, moments: NO_MOMENTS } });
    for (const p of [0, 1]) {
      const here = { look, phrase: p };
      out.push(
        { name: `${look} p${p} gather on`, from: { ...here, moments: NO_MOMENTS }, to: { ...here, moments: GATHER } },
        { name: `${look} p${p} gather off`, from: { ...here, moments: GATHER }, to: { ...here, moments: NO_MOMENTS } },
        { name: `${look} p${p} fan on`, from: { ...here, moments: NO_MOMENTS }, to: { ...here, moments: FAN } },
        { name: `${look} p${p} fan off`, from: { ...here, moments: FAN }, to: { ...here, moments: NO_MOMENTS } },
        { name: `${look} p${p} gather to fan`, from: { ...here, moments: GATHER }, to: { ...here, moments: FAN } },
        { name: `${look} p${p} fan to gather`, from: { ...here, moments: FAN }, to: { ...here, moments: GATHER } },
      );
    }
  }
  return out;
}
const aim = (s: Shape, phaseDeg: number): Direction[] =>
  FIXTURES.map((fixture) => beamDirection({ look: s.look, fixture, phaseDeg, phrase: phraseOfIndex(s.phrase), moments: s.moments }));

test("every transition, fixture and phase at 30, 60 and 144 fps: at most 30 degrees a second on every frame, there within 3.5 s plus one frame", () => {
  let worstArrival = 0;
  let biggestStep = 0;
  let drives = 0;
  for (const fps of FPS) {
    const dt = 1 / fps;
    for (const t of transitions()) for (const phase of PHASES) {
      const from = aim(t.from, phase);
      const to = aim(t.to, phase);
      biggestStep = Math.max(biggestStep, ...from.map((d, i) => angleBetween(d, to[i]!)));
      let drawn: readonly Direction[] = from;
      let frames = 0;
      while (frames < 1000 && drawn.some((d, i) => angleBetween(d, to[i]!) > 0)) {
        const next = turnToward(drawn, to, dt, false);
        next.forEach((d, i) => assert.ok(angleBetween(drawn[i]!, d) / dt <= MAX_DEG_PER_SECOND * SLACK, `${t.name} @${fps}: ${angleBetween(drawn[i]!, d) / dt} deg/s`));
        drawn = next;
        frames++;
      }
      const arrival = frames * dt;
      assert.ok(arrival <= REACH_S + dt, `${t.name} phase ${phase} @${fps}: there after ${arrival} s`);
      worstArrival = Math.max(worstArrival, arrival);
      drives++;
    }
  }
  assert.ok(drives > 1500);
  assert.ok(biggestStep > 100 && biggestStep < 105, `the largest step is ${biggestStep}`); // spec: 104.7, so the drive is not vacuous
  assert.ok(worstArrival > 3.3, `the worst case is near the bound: ${worstArrival}`);
});

test("stalled frames of 250 ms and 1 s are clamped to 100 ms: a beam turns at most 3 degrees on them", () => {
  const from = aim({ look: "fan", phrase: 0, moments: NO_MOMENTS }, 0);
  const to = aim({ look: "fan", phrase: 1, moments: NO_MOMENTS }, 0);
  for (const stall of [0.25, 1, 60]) {
    let drawn: readonly Direction[] = from;
    for (const raw of [1 / 60, 1 / 60, stall, 1 / 60, stall, stall]) {
      const next = turnToward(drawn, to, raw, false);
      next.forEach((d, i) => assert.ok(angleBetween(drawn[i]!, d) <= Math.min(raw, 0.1) * MAX_DEG_PER_SECOND + 0.01));
      if (raw === stall) next.forEach((d, i) => assert.ok(angleBetween(drawn[i]!, d) <= 3.01));
      drawn = next;
    }
  }
});

interface Segment { readonly songIndex: number; readonly fromMs: number; readonly toMs: number }
// A phrase flip (song 0 at 120 bpm flips at 16 s), a song change from that mirrored phrase, and a
// build (from 36 s) with its drop (40 s, the fan for 8 s).
const SEGMENTS: readonly (readonly Segment[])[] = [
  [{ songIndex: 0, fromMs: 14_000, toMs: 19_000 }, { songIndex: 1, fromMs: 0, toMs: 6_000 }],
  [{ songIndex: 0, fromMs: 34_000, toMs: 52_000 }],
];

test("the renderer's own step (stepRig) never turns a beam over 30 degrees a second through a phrase flip, a song change and a build with its drop", () => {
  for (const fps of FPS) for (const stalls of [false, true]) {
    let sawTargetJump = 0;
    for (const run of SEGMENTS) {
      let state: RigState = START_STATE;
      let prev: readonly Direction[] | null = null;
      let prevTargets: readonly Direction[] | null = null;
      let frame = 0;
      for (const seg of run) for (let pos = seg.fromMs; pos < seg.toMs; frame++) {
        const stall = stalls && frame > 0 && frame % 97 === 0 ? (frame % 2 === 0 ? 0.25 : 1) : null;
        const raw = stall ?? 1 / fps;
        const s = stepRig(state, { cls: classA, classMs: pos, songIndex: seg.songIndex, songPosMs: pos, link: { state: "Locked" }, rawDtSeconds: raw });
        if (prev) s.drawn.forEach((d, i) => assert.ok(angleBetween(prev![i]!, d) / s.dtSeconds <= MAX_DEG_PER_SECOND * SLACK, `${fps} fps frame ${frame}`));
        if (prevTargets) sawTargetJump = Math.max(sawTargetJump, ...s.frame.directions.map((d, i) => angleBetween(prevTargets![i]!, d)));
        assert.ok(s.dtSeconds <= 0.1);
        prev = s.drawn;
        prevTargets = s.frame.directions;
        state = s.state;
        pos += s.dtSeconds * 1000; // the class clock moves by the frame time used
      }
    }
    assert.ok(sawTargetJump > 60, `the run has real steps in the targets: ${sawTargetJump}`);
  }
});
