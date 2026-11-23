// #617, the property test on the whole frame: random timelines of seeks, jumps and link events (lost and regained lock,
// pause and resume) drive the rig's own step (`stepRig`), and on every one:
//   - the beams are off their targets (a sweep) only inside a window the scheduler plans: a foreseen turn from the frame
//     its target changes, or the turn after an unforeseen cause from 2 s after the cause's frame, 4.15 s long;
//   - no run (a ramp, a burst, a dim; the run in progress cut at the cause's frame) is placed from 1 s before an unforeseen
//     turn to its window's end;
//   - no 1 s window holds more than 3 counted changes (marks, runs, and the sweep or steady light as 1), no exception.
// Removing the hold moves the turn to the cause's frame, outside every plan: the first check fails.
import assert from "node:assert/strict";
import { test } from "node:test";
import { placeMarks } from "../src/flash-marks.ts";
import type { Want } from "../src/flash-marks.ts";
import { STEADY_PER_WINDOW, fitRuns, maxInASecond } from "../src/flash-runs.ts";
import type { RunWish, Span } from "../src/flash-runs.ts";
import type { LinkInput } from "../src/beat-level.ts";
import { START_STATE, stepRig } from "../src/step.ts";
import type { RigState } from "../src/step.ts";
import { UNFORESEEN_HOLD_MS, endRunsAtCauses } from "../src/unforeseen.ts";
import { angleBetween } from "../src/turn.ts";
import { classA } from "./fixtures.ts";

const TIMELINES = 120;
const WINDOW_MS = 4150; // `--scene-sweep-window`
const locked: LinkInput = { state: "Locked" };

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]! };
}

interface Frame { readonly ms: number; readonly off: boolean; readonly jump: boolean; readonly cause: boolean; readonly held: boolean }

function drive(seed: number): { frames: Frame[]; causes: number[]; frameMs: number } {
  const r = rng(seed);
  const fps = r.pick([30, 60, 144]);
  const dt = 1 / fps;
  const links: LinkInput[] = [locked, { state: "Coasting" }, { state: "Paused" }, { state: "Ambiguous" }];
  let state: RigState = START_STATE;
  let ms = r.int(0, 60_000);
  let link: LinkInput = locked;
  let prevTargets: ReturnType<typeof stepRig>["frame"]["directions"] | null = null;
  const frames: Frame[] = [];
  const causes: number[] = [];
  const total = r.int(20, 50) * fps;
  const events = new Set(Array.from({ length: r.int(2, 9) }, () => r.int(fps, total - 1)));
  for (let n = 0; n < total; n++) {
    if (events.has(n)) {
      if (r.next() < 0.5) ms = r.int(0, 90_000); // a seek or a jump
      else link = r.pick(links);
    }
    const out = stepRig(state, { cls: classA, classMs: ms, songIndex: 0, songPosMs: ms, link, rawDtSeconds: dt });
    const jump = prevTargets !== null && out.frame.directions.some((d, i) => angleBetween(d, prevTargets![i]!) > 6);
    const off = out.drawn.some((d, i) => angleBetween(d, out.frame.directions[i]!) > 0);
    frames.push({ ms, off: off && !out.held, jump, cause: out.cause !== null, held: out.held }); // held on the old aim is the hold, not a turn
    if (out.cause !== null) causes.push(ms);
    prevTargets = out.frame.directions;
    state = out.state;
    if (link.state !== "Paused") ms += out.dtSeconds * 1000; // the class clock stands still while paused
  }
  return { frames, causes, frameMs: 1000 / fps };
}

function oneTimeline(seed: number): void {
  const { frames, causes, frameMs } = drive(seed);
  const r = rng(seed * 7919);
  // The scheduler's plan: the foreseen turns (a target that changes outside a hold) and the turn 2 s after each cause.
  const foreseen = frames.filter((f) => f.jump && !f.cause && !f.held).map((f) => f.ms);
  const unforeseen = causes.map((c) => c + UNFORESEEN_HOLD_MS);
  const planned: Span[] = [...foreseen, ...unforeseen].map((t) => ({ fromMs: t - frameMs - 1e-6, toMs: t + WINDOW_MS + frameMs }));
  for (const f of frames.filter((x) => x.off)) assert.ok(planned.some((p) => f.ms >= p.fromMs && f.ms <= p.toMs), `seed ${seed}: the beams are off target at ${f.ms} outside every planned window (causes ${JSON.stringify(causes.map(Math.round))}, foreseen ${JSON.stringify(foreseen.map(Math.round))})`);

  // The marks: every cause is a user action or a link event with its own frame (P2), beside a tick a second.
  const end = Math.max(...frames.map((f) => f.ms)) + 1;
  const wants: Want[] = causes.map((c) => ({ kind: "action", atMs: c }));
  for (let t = r.int(0, 999); t < end; t += 1000) wants.push({ kind: "tick", atMs: t, periodMs: 1000 });
  const placed = placeMarks([], wants, frameMs);
  const marks = placed.flatMap((p) => (p.how === "own" || p.how === "joined" ? [p.atMs!] : []));
  const causeFrames = placed.flatMap((p) => (p.want.kind === "action" && p.atMs !== null ? [{ atMs: p.want.atMs, frameMs: p.atMs }] : []));

  const wishes: RunWish[] = [];
  for (let k = 0; k < 40; k++) {
    const t = r.int(0, end);
    wishes.push({ id: `w${k}`, kind: r.pick(["ramp", "lightBurst", "dim"] as const), pieces: [{ fromMs: t, toMs: t + r.pick([250, 700]) }], waits: r.next() < 0.3 });
  }
  const plan = fitRuns(wishes, { marks, beat: [{ fromMs: -1e9, toMs: 1e9 }], count: [], beatMs: 500, endMs: end, frameMs, sweeps: foreseen, unforeseenTurns: unforeseen });
  const runs = endRunsAtCauses(plan.runs, causeFrames, frameMs);
  const pieces = runs.flatMap((run) => run.pieces);

  // The turn after a cause is where it was planned (above), so no run, cut at the cause's frame, is near it.
  for (const p of pieces) for (const t of unforeseen) assert.ok(!(p.toMs > t - 1000 + 1e-6 && p.fromMs < t + WINDOW_MS - 1e-6), `seed ${seed}: a run near the turn at ${t}`);
  // At most 3 in any 1 s window, steady light or a sweep counted as 1, with no exception.
  const counted = [...new Set(marks.map((m) => Math.round(m * 1000)))].map((m) => ({ fromMs: m / 1000, toMs: m / 1000 }));
  const worst = maxInASecond([...counted, ...pieces]) + STEADY_PER_WINDOW;
  assert.ok(worst <= 3, `seed ${seed}: a 1 s window holds ${worst} changes`);
}

test(`unforeseen causes: ${TIMELINES} random seek and link-event timelines draw sweeps only where planned, keep runs out of them and every 1 s window at 3 or fewer`, () => {
  for (let seed = 1; seed <= TIMELINES; seed++) oneTimeline(seed);
});

test("the timelines really hold: causes happen and some beam is off target after a hold", () => {
  let causes = 0;
  let sweeps = 0;
  for (let seed = 1; seed <= 30; seed++) { const d = drive(seed); causes += d.causes.length; sweeps += d.frames.filter((f) => f.off).length; }
  assert.ok(causes > 100 && sweeps > 500, `${causes} causes, ${sweeps} off-target frames`);
});
