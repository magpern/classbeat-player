// The property test of the flash-budget scheduler (#577, required by scene.md "The flash budget"): random timelines
// (intervals of any length down to 1 ms, drops anywhere, user actions, the beat locked, lost and found, a count
// running or not, every refresh rate, tempo and zone) go through the scheduler, and on every one:
//   - any two frame marks are at least 500 ms apart;
//   - no 1 s window holds more than 3 counted changes, steady light's possible change included;
//   - nothing steps inside a run;
//   - fixed frames never move later (but by P1's merge);
//   - an action shows at most 500 ms after it, or 1 s when it joins a fixed frame;
//   - beam direction depends only on the song position (S7): merging an interval away moves no beam.
// The strict 40-region gate on the real running scene (render/tools/flash-shots.ts) stays the final authority.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixedFrames, frameAt, placeMarks } from "../src/flash-marks.ts";
import type { Want } from "../src/flash-marks.ts";
import { SWEEP_MS, STEADY_PER_WINDOW, fitRuns } from "../src/flash-runs.ts";
import type { RunWish, Span } from "../src/flash-runs.ts";
import { sceneFrame } from "../src/frame.ts";
import { mergeIntervals } from "../src/merge-intervals.ts";
import type { SceneClass } from "../src/frame.ts";
import { ZONES } from "../src/energy.ts";

const TIMELINES = 600;
const TOL = 1e-6;

/** A small seeded generator (mulberry32), so a failure names a seed and reruns the same. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]! };
}

/** Times in a span of the class: uniform, in clusters (gaps of 1 ms to 3 s), or the same instant repeated. */
function times(r: ReturnType<typeof rng>, count: number, endMs: number): number[] {
  const out: number[] = [];
  let at = r.next() * endMs * 0.3;
  for (let i = 0; i < count; i++) {
    const mode = r.next();
    at = mode < 0.35 ? r.next() * endMs : mode < 0.6 ? at + r.int(1, 30) : mode < 0.8 ? at + r.int(100, 1200) : at + r.int(1000, 3000);
    out.push(Math.min(endMs - 1, at));
  }
  return out;
}

function spans(r: ReturnType<typeof rng>, endMs: number): Span[] {
  const out: Span[] = [];
  let at = r.next() < 0.3 ? 0 : r.int(0, 8000);
  while (at < endMs) {
    const len = r.int(500, 25_000);
    out.push({ fromMs: at, toMs: Math.min(endMs, at + len) });
    at += len + r.int(1, 6000);
  }
  return r.next() < 0.1 ? [] : out;
}

/** The most items in any 1 s window, found by brute force over every window that starts as an item enters (or an item starts, or ends). */
function brute(items: readonly Span[]): { n: number; held: readonly Span[] } {
  const starts = new Set<number>();
  for (const s of items) { starts.add(s.fromMs - 1000 + 2e-5); starts.add(s.toMs + 1e-5); starts.add(s.fromMs); }
  let best: { n: number; held: readonly Span[] } = { n: 0, held: [] };
  for (const w of starts) {
    const held = items.filter((s) => s.fromMs < w + 1000 - 1e-5 && (s.toMs > w || (s.toMs === s.fromMs && s.fromMs >= w)));
    if (held.length > best.n) best = { n: held.length, held };
  }
  return best;
}

function oneTimeline(seed: number): void {
  const r = rng(seed);
  const frameMs = r.pick([1000 / 60, 1000 / 50, 1000 / 144, 1000 / 30, 1000 / 72, 1]);
  const endMs = r.int(10_000, 80_000);
  const beatMs = r.pick([240, 300, 333, 400, 500, 600, 750, 1000, 1500, 2000]); // 250 to 30 bpm
  const beat = spans(r, endMs);
  const count = beat.flatMap((b) => (r.next() < 0.5 ? [{ fromMs: b.fromMs + r.int(0, 2000), toMs: b.toMs }].filter((c) => c.toMs > c.fromMs) : []));
  const changes = times(r, r.int(0, 30), endMs);
  const drops = times(r, r.int(0, 10), endMs);
  const fixed = fixedFrames(changes, drops, frameMs);

  const wants: Want[] = [];
  for (const t of times(r, r.int(0, 25), endMs)) wants.push({ kind: "action", atMs: t });
  for (let t = r.int(0, 999); t < endMs; t += 1000) wants.push({ kind: "tick", atMs: t, periodMs: 1000 });
  for (const c of count) {
    const sideBeats = r.int(1, 8);
    for (let k = 0, t = c.fromMs; t < c.toMs; k++, t += beatMs) wants.push({ kind: k % sideBeats === 0 ? "switch" : "tick", atMs: t, periodMs: beatMs });
  }
  const placed = placeMarks(fixed, wants, frameMs);
  // A mark already shown never moves for an action that arrives later: without the actions, every tick shown by the
  // first action is placed exactly as it is with them.
  const firstAction = Math.min(...wants.filter((w) => w.kind === "action").map((w) => w.atMs));
  const calm = placeMarks(fixed, wants.filter((w) => w.kind !== "action"), frameMs);
  wants.filter((w) => w.kind !== "action").forEach((w, i) => {
    const [a, b] = [calm[i]!, placed[wants.indexOf(w)]!];
    if (a.how === "own" && a.atMs! <= firstAction - 1e-6) assert.deepEqual([b.how, b.atMs], [a.how, a.atMs], `seed ${seed}: a mark shown at ${a.atMs} moved for an action at ${firstAction}`);
  });
  const marks = [...fixed.map((f) => f.atMs), ...placed.flatMap((p) => (p.how === "own" ? [p.atMs!] : []))];

  // 1. Any two frame marks are at least 500 ms apart.
  const sorted = [...marks].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i]! - sorted[i - 1]! >= 500 - TOL, `seed ${seed}: marks ${sorted[i - 1]} and ${sorted[i]} are under 500 ms apart`);
  // 2. Fixed frames never move later than the frame of the first change they hold (or the first drop), and are 1 s or more apart.
  for (const f of fixed) {
    const first = f.change ? f.changes[0]! : f.drops[0]!;
    assert.ok(f.atMs >= first - TOL && f.atMs - first < frameMs + TOL, `seed ${seed}: a fixed frame moved from ${first} to ${f.atMs}`);
    assert.ok(Math.abs(f.atMs / frameMs - Math.round(f.atMs / frameMs)) < 1e-6, `seed ${seed}: a frame is on the refresh grid`);
  }
  for (let i = 1; i < fixed.length; i++) assert.ok(fixed[i]!.atMs - fixed[i - 1]!.atMs >= 1000 - frameMs - TOL, `seed ${seed}: fixed frames under 1 s apart`);
  assert.equal(fixed.reduce((n, f) => n + f.changes.length, 0), changes.length, `seed ${seed}: every change is in a frame`);
  // 3. An action shows within 500 ms of it, or 1 s when it joined a fixed frame; every placed frame is a mark.
  for (const p of placed) {
    if (p.atMs === null) { assert.equal(p.want.kind === "action", false, `seed ${seed}: an action is never dropped`); continue; }
    assert.ok(marks.some((m) => Math.abs(m - p.atMs!) < TOL), `seed ${seed}: ${p.how} frame is a mark`);
    if (p.want.kind !== "action") continue;
    assert.ok(p.atMs - p.want.atMs <= (p.how === "joined" || fixed.some((f) => Math.abs(f.atMs - p.atMs!) < TOL) ? 1000 : 500) + TOL && p.atMs >= p.want.atMs - TOL, `seed ${seed}: action at ${p.want.atMs} shows at ${p.atMs} (${p.how})`);
  }

  // Runs: a ramp that ends the frame before every merged change frame, bursts, dims, and ramps that may wait.
  const wishes: RunWish[] = [];
  fixed.forEach((f, i) => {
    if (f.change) wishes.push({ id: `ramp${i}`, kind: "ramp", pieces: [{ fromMs: f.atMs - 700, toMs: f.atMs - frameMs }] });
    if (f.change && r.next() < 0.5) wishes.push({ id: `light${i}`, kind: "lightBurst", pieces: [{ fromMs: f.atMs + frameMs, toMs: f.atMs + 250 }] });
    if (f.drops.length > 0) wishes.push({ id: `drop${i}`, kind: "dropBurst", pieces: [{ fromMs: f.atMs + frameMs, toMs: f.atMs + 250 }] });
  });
  for (const t of times(r, r.int(0, 8), endMs)) wishes.push({ id: `dim${t}`, kind: "dim", pieces: [{ fromMs: t, toMs: t + 120 }, { fromMs: t + beatMs, toMs: t + beatMs + 120 }] });
  for (const t of times(r, r.int(0, 6), endMs)) wishes.push({ id: `wait${t}`, kind: "ramp", waits: true, pieces: [{ fromMs: t, toMs: t + 700 }] });
  const sweeps = times(r, r.int(0, 4), endMs);
  const plan = fitRuns(wishes, { marks, beat, count, beatMs, endMs, frameMs, sweeps });
  assert.equal(plan.runs.length + plan.steps.length + plan.skipped.length, wishes.length, `seed ${seed}: every wish is placed, a step or skipped`);

  const pieces = plan.runs.flatMap((run) => run.pieces);
  // 4. Nothing steps inside a run, no run overlaps another, and there is no ramp or dim without the beat and no run with a count running.
  for (const run of plan.runs) for (const p of run.pieces) {
    if (run.wish.kind === "ramp" || run.wish.kind === "dim") assert.ok(beat.some((b) => b.fromMs <= p.fromMs && b.toMs >= p.toMs), `seed ${seed}: a ramp or a dim without the beat`);
  }
  for (const p of pieces) {
    assert.deepEqual(marks.filter((m) => m > p.fromMs + TOL && m <= p.toMs + TOL), [], `seed ${seed}: a mark inside the run ${p.fromMs} to ${p.toMs}`);
    assert.ok(!count.some((c) => p.fromMs < c.toMs && c.fromMs < p.toMs), `seed ${seed}: a run with a count running`);
    for (const q of pieces) if (q !== p) assert.ok(!(p.fromMs < q.toMs - TOL && q.fromMs < p.toMs - TOL), `seed ${seed}: runs overlap`);
  }
  // 5. No 1 s window holds more than 3 counted changes: marks, runs, steady light's possible change.
  const counted = sorted.filter((m, i) => i === 0 || m - sorted[i - 1]! > TOL).map((m) => ({ fromMs: m, toMs: m }));
  // Steady light is one change in every window, the beat running or not (an oracle of its own: the constant, not the module's code).
  const worst = brute([...counted, ...pieces]);
  assert.ok(worst.n + 1 <= 3 && STEADY_PER_WINDOW === 1, `seed ${seed}: a 1 s window holds ${worst.n} changes and steady light: ${JSON.stringify(worst.held)}`);
  for (const p of pieces) for (const f of sweeps) assert.ok(!(p.fromMs < f + SWEEP_MS && f < p.toMs), `seed ${seed}: a run in a sweep`);
  assert.ok(brute(counted).n <= 2, `seed ${seed}: marks alone are at most 2 in a second`);

  // 6. S7: merging an interval away moves no beam; the direction is the song position's alone.
  const intervals = changes.map((t) => ({ startMs: t, zone: r.pick(ZONES) })).sort((a, b) => a.startMs - b.startMs);
  const songs = [{ bpm: 60_000 / beatMs, anchors: [{ at_ms: 0, bpm: 60_000 / beatMs }], moments: drops.slice(0, 3).map((d) => ({ at_ms: d, kind: "drop" as const })) }];
  const full: SceneClass = { songs, intervals: [{ startMs: 0, zone: 1 }, ...intervals], endMs };
  const kept = mergeIntervals(full); // the scheduler's own P1 output: the rig's class with the merged-away intervals gone
  assert.ok(kept.intervals.length <= full.intervals.length, `seed ${seed}: a merge only removes intervals`);
  for (let k = 0; k < 6; k++) {
    const pos = r.int(0, endMs);
    const link = { state: r.pick(["Locked", "Coasting"] as const) };
    const [a, b] = [full, kept].map((cls) => sceneFrame({ cls, classMs: pos, songIndex: 0, songPosMs: pos, phaseDeg: (pos / 100) % 360, link }).directions);
    assert.deepEqual(a, b, `seed ${seed}: a beam moved with the intervals`);
  }
  assert.ok(frameAt(0, frameMs) === 0);
}

test(`scheduler property: ${TIMELINES} random timelines keep the marks 500 ms apart, the runs whole and every 1 s window at 3 changes or fewer`, () => {
  for (let seed = 1; seed <= TIMELINES; seed++) oneTimeline(seed);
});
