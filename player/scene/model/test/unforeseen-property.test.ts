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
import { fixedFrames, placeMarks } from "../src/flash-marks.ts";
import type { Want } from "../src/flash-marks.ts";
import { STEADY_PER_WINDOW, fitRuns, maxInASecond } from "../src/flash-runs.ts";
import type { RunWish, Span } from "../src/flash-runs.ts";
import type { LinkInput } from "../src/beat-level.ts";
import { START_STATE, stepRig } from "../src/step.ts";
import type { RigState } from "../src/step.ts";
import { UNFORESEEN_HOLD_MS, causeFrame, endRunsAtCauses } from "../src/unforeseen.ts";
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

const midRuns = { count: 0 };
/** Off only to prove the 1 s clear rule is what holds the count (see the mutation test). */
let ENFORCE_CLEAR = true;
let ENFORCE_END = true;

function oneTimeline(seed: number, withFixed = true): void {
  const { frames, causes, frameMs } = drive(seed);
  const r = rng(seed * 7919);
  // The scheduler's plan: the foreseen turns (a target that changes outside a hold) and the turn 2 s after each cause.
  const foreseen = frames.filter((f) => f.jump && !f.cause && !f.held).map((f) => f.ms);
  const unforeseen = causes.map((c) => c + UNFORESEEN_HOLD_MS);
  const planned: Span[] = [...foreseen, ...unforeseen].map((t) => ({ fromMs: t - frameMs - 1e-6, toMs: t + WINDOW_MS + frameMs }));
  for (const f of frames.filter((x) => x.off)) assert.ok(planned.some((p) => f.ms >= p.fromMs && f.ms <= p.toMs), `seed ${seed}: the beams are off target at ${f.ms} outside every planned window (causes ${JSON.stringify(causes.map(Math.round))}, foreseen ${JSON.stringify(foreseen.map(Math.round))})`);

  // The scheduler plans its marks and runs without knowing the causes (a cause cannot be foreseen): a tick a second, and runs
  // (ramps, bursts, two-piece dims), many of them under a later cause so that it lands mid-run.
  const end = Math.max(...frames.map((f) => f.ms)) + 1;
  const ticks: Want[] = [];
  for (let t = r.int(0, 999); t < end; t += 1000) ticks.push({ kind: "tick", atMs: t, periodMs: 1000 });
  // Fixed frames (P1): interval changes and drops, which a cause's mark may have to join.
  const rf = rng(seed * 104729); // its own stream, so the other draws of a seed do not move
  const fixed = withFixed ? fixedFrames(Array.from({ length: rf.int(0, 8) }, () => rf.int(0, end)), Array.from({ length: rf.int(0, 4) }, () => rf.int(0, end)), frameMs) : [];
  const fixedAt = fixed.map((f) => f.atMs);
  const placedTicks = placeMarks(fixed, ticks, frameMs);
  const tickMarks = [...fixedAt, ...placedTicks.flatMap((p) => (p.atMs === null || fixedAt.includes(p.atMs) ? [] : [p.atMs]))];
  let tickNow: { want: Want; frame: number | null }[] = placedTicks.map((p) => ({ want: p.want, frame: p.atMs }));
  const wishes: RunWish[] = [];
  const wishAt = (t: number, k: number): void => {
    const kind = r.pick(["ramp", "lightBurst", "dim"] as const);
    const pieces = kind === "dim" ? [{ fromMs: t, toMs: t + 120 }, { fromMs: t + 500, toMs: t + 620 }] : [{ fromMs: t, toMs: t + r.pick([250, 700]) }];
    wishes.push({ id: `w${k}`, kind, pieces, waits: r.next() < 0.3 });
  };
  for (let k = 0; k < 40; k++) wishAt(r.int(0, end), k);
  causes.forEach((c, k) => { for (let m = 0; m < 3; m++) wishAt(c - r.int(0, 600), 100 + k * 3 + m); });
  const room = { beat: [{ fromMs: -1e9, toMs: 1e9 }], count: [], beatMs: 500, endMs: end, frameMs, sweeps: foreseen };
  const plan0 = fitRuns(wishes, { ...room, marks: tickMarks });

  // Then the causes arrive, one at a time in time order. Each gets its own frame (P2, 1 s clear of a run that has ended), the runs
  // in progress are cut in it, and a run not yet started is decided again with the cause known.
  const span = (run: { pieces: readonly Span[] }) => ({ from: Math.min(...run.pieces.map((p) => p.fromMs)), to: Math.max(...run.pieces.map((p) => p.toMs)) });
  const midRun = (run: { pieces: readonly Span[] }, c: { atMs: number }) => span(run).from < c.atMs && c.atMs < span(run).to;
  let runs = plan0.runs;
  const absorbed: number[] = [];
  let known: number[];
  const causeMarks: number[] = [];
  const turns: number[] = [];
  const causeFrames: { atMs: number; frameMs: number }[] = [];
  const lates: unknown[] = [];
  for (const at of [...causes].sort((a, b) => a - b)) {
    // The ticks not yet shown when the cause arrives give way and are placed again after it (P2); the marks already shown stay.
    const shown = [...causeMarks, ...tickNow.flatMap((t) => (t.frame !== null && t.frame <= at ? [t.frame] : []))];
    const mark0 = causeFrame(at, frameMs, shown, (ENFORCE_CLEAR ? runs : []).filter((x) => ENFORCE_END || !midRun(x, { atMs: at })), causeMarks, fixedAt, absorbed);
    lates.push(...mark0.late);
    const f = mark0.frameMs;
    const c = { atMs: at, frameMs: f };
    causeFrames.push(c);
    const late = runs.filter((x) => !midRun(x, c) && span(x).from >= c.atMs);
    const cutNow = endRunsAtCauses(runs.filter((x) => !late.includes(x)), [c], frameMs);
    absorbed.push(...cutNow.absorbed);
    midRuns.count += cutNow.absorbed.length;
    if (!causeMarks.includes(c.frameMs)) causeMarks.push(c.frameMs); // a merged cause has no mark of its own
    const future = tickNow.filter((t) => t.frame === null || t.frame > at);
    const again = placeMarks(fixed, future.map((t) => t.want), frameMs, [...shown, c.frameMs]);
    tickNow = [...tickNow.filter((t) => t.frame !== null && t.frame <= at), ...future.map((t, i) => ({ want: t.want, frame: again[i]!.atMs }))];
    known = [...fixedAt, ...causeMarks, ...tickNow.flatMap((t) => (t.frame === null ? [] : [t.frame]))];
    turns.push(c.atMs + UNFORESEEN_HOLD_MS);
    runs = fitRuns(late.map((x) => x.wish), { ...room, marks: known, unforeseenTurns: turns, placed: cutNow.runs }).runs;
  }
  assert.ok(lates.length === 0, `seed ${seed}: a cause's mark is 1 s or more late: ${JSON.stringify(lates)}`); // decision 9b: S6 wins over C10, and no timeline needs it
  const pieces = runs.flatMap((run) => run.pieces);

  // The turn after a cause is where it was planned (above), so no run, cut at the cause's frame, is near it.
  for (const p of pieces) for (const t of unforeseen) assert.ok(!(p.toMs > t - 1000 + 1e-6 && p.fromMs < t + WINDOW_MS - 1e-6), `seed ${seed}: a run ${p.fromMs} to ${p.toMs} near the turn at ${t} (causes ${JSON.stringify(causeFrames.map((c) => [Math.round(c.atMs), Math.round(c.frameMs)]))})`);
  // At most 3 in any 1 s window, steady light or a sweep counted as 1, with no exception. A cause's mark that a cut run ends in is one change with it.
  const finalTicks = tickNow.flatMap((t) => (t.frame === null ? [] : [t.frame]));
  const marks = [...fixedAt, ...finalTicks, ...causeFrames.map((c) => c.frameMs)].filter((m, i, all) => all.indexOf(m) === i && !absorbed.some((a) => Math.abs(a - m) < 1e-6 && !finalTicks.includes(m)));
  const counted = marks.map((m) => ({ fromMs: m, toMs: m }));
  // A burst's decay is inside the shared 1 (scene.md "A burst's decay is light inside the shared 1"): it is not counted beside it, and no other run lies within 1 s of it.
  const decays = runs.filter((x) => x.wish.kind.endsWith("Burst")).flatMap((x) => x.pieces);
  const others = runs.filter((x) => !x.wish.kind.endsWith("Burst")).flatMap((x) => x.pieces);
  for (const d of decays) for (const o of others) assert.ok(!(o.fromMs < d.toMs + 1000 - 1e-6 && d.fromMs < o.toMs + 1000 - 1e-6), `seed ${seed}: a run ${o.fromMs} to ${o.toMs} within 1 s of a decay ${d.fromMs} to ${d.toMs}`);
  const worst = maxInASecond([...counted, ...others]) + STEADY_PER_WINDOW;
  assert.ok(worst <= 3, `seed ${seed}: a 1 s window holds ${worst} changes: ${JSON.stringify([...counted.map((c) => [Math.round(c.fromMs), "mark"]), ...pieces.map((p) => [Math.round(p.fromMs), Math.round(p.toMs)])].sort((a, b) => Number(a[0]) - Number(b[0])))} causes ${JSON.stringify(causeFrames.map((c) => [Math.round(c.atMs), Math.round(c.frameMs)]))}`);
}

test(`unforeseen causes: ${TIMELINES} random seek and link-event timelines draw sweeps only where planned, keep runs out of them and every 1 s window at 3 or fewer`, () => {
  for (let seed = 1; seed <= TIMELINES; seed++) { oneTimeline(seed); oneTimeline(seed, false); } // with fixed frames, and with none
  assert.ok(midRuns.count > 50, `causes really land mid-run: ${midRuns.count}`);
});

test("seed 2, pinned: a run, a tick and a cause 548 ms after the run ended keep 3 in 1 s because the cause's mark waits 1 s after the run", () => {
  oneTimeline(2, false);
});

test("seed 42, pinned: a cause 0.9 s after another cause, with a run just ended, merges into that cause's mark", () => {
  oneTimeline(42, false);
});

test("seed 68, pinned: a cause just after a run, a shown tick and a fixed frame ahead: its mark takes the first frame that keeps every window at 3", () => {
  oneTimeline(68);
});

test("seed 53, pinned: a cause within a second of an earlier cause merges into its mark; no frame of its own exists", () => {
  oneTimeline(53, false);
});

test("seed 7, pinned: a cause 518 ms after a run, with a tick shown before it, keeps 3 in a second", () => {
  oneTimeline(7);
});

test("seed 24, pinned: a cause in a run whose own frame comes after the run's end takes the run's end frame as its mark", () => {
  oneTimeline(24);
});

test("mutations: without the window check seed 2 holds 4 in a second; without the run's end frame as the mark seed 7 holds 4", () => {
  ENFORCE_CLEAR = false;
  try { assert.throws(() => oneTimeline(2, false), /holds 4 changes/); } finally { ENFORCE_CLEAR = true; }
  ENFORCE_END = false;
  try { assert.throws(() => oneTimeline(7, false), /holds 4 changes/); } finally { ENFORCE_END = true; }
});

test("the timelines really hold: causes happen and some beam is off target after a hold", () => {
  let causes = 0;
  let sweeps = 0;
  for (let seed = 1; seed <= 30; seed++) { const d = drive(seed); causes += d.causes.length; sweeps += d.frames.filter((f) => f.off).length; }
  assert.ok(causes > 100 && sweeps > 500, `${causes} causes, ${sweeps} off-target frames`);
});
