// The property test of #618 over link-state pairs (locked, coasting, Tempo only; before the link changes, after it): random songs
// (tempo, length, drops anywhere, none or several), random interval changes (P1 merges them onto drops), a link event in the
// middle (an unforeseen cause), and on every one, whatever the pair:
//   - no run overlaps a sweep's planned window, and no decay lies in one;
//   - every window a decay comes within 1 s of is cut to 1 s or more clear of it, its planned window kept whole;
//   - no run other than a burst lies within 1 s of a decay, and no 1 s window counts more than 3 (the decay inside the shared 1);
//   - a burst is skipped only for a cause: a window holds its decay, another run lies within 1 s, or it overlaps a burst;
//   - a burst placed locked is placed coasting (the link adds runs, never takes a place away);
//   - the fan's turn starts 2250 ms after the drop's moment, whatever P1 merges, and a drop less than 2.25 s before the song's end has none.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixedFrames } from "../src/flash-marks.ts";
import { fitRuns, maxInASecond } from "../src/flash-runs.ts";
import type { RunPlan, RunWish, Span } from "../src/flash-runs.ts";
import { FAN_TURN_DELAY_MS } from "../src/fan-turn.ts";
import type { SceneSong } from "../src/frame.ts";
import { cutSpan, minDarkMs, planSpans } from "../src/dark.ts";
import { songChangeSweep, songSweeps } from "../src/sweeps.ts";
import { turningMoments } from "../src/turn-moments.ts";

const STATES = ["locked", "coasting", "tempo only"] as const;
type State = (typeof STATES)[number];
const SEEDS = 80;
const TOL = 1e-6;

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]! };
}

const gap = (a: Span, b: Span): number => Math.max(a.fromMs - b.toMs, b.fromMs - a.toMs);
const isBurst = (w: RunWish) => w.kind.endsWith("Burst");

interface Timeline { readonly song: SceneSong; readonly frameMs: number; readonly wishes: RunWish[]; readonly marks: number[]; readonly windows: (Span & { readonly swayAfter: boolean })[]; readonly beatMs: number; readonly lengthMs: number; readonly switchAt: number }

function timeline(seed: number): Timeline {
  const r = rng(seed);
  const frameMs = r.pick([1000 / 60, 1000 / 144, 1000 / 30]);
  const bpm = r.pick([60, 90, 120, 128, 150, 180, 200]);
  const lengthMs = r.int(30_000, 120_000);
  const drops = Array.from({ length: r.int(0, 3) }, () => (r.next() < 0.4 ? lengthMs - r.int(0, 6000) : r.int(12_000, lengthMs - 1000))).sort((x, y) => x - y);
  const song: SceneSong = { bpm, anchors: [{ at_ms: 0, bpm }], moments: drops.map((at_ms) => ({ at_ms, kind: "drop" as const })), lengthMs };
  const changes = Array.from({ length: r.int(1, 14) }, () => r.int(5000, lengthMs - 500));
  for (const d of drops) if (r.next() < 0.5) changes.push(d + r.int(-950, 950)); // a change near a drop: P1 merges them
  const fixed = fixedFrames(changes, drops, frameMs);
  const wishes: RunWish[] = [];
  let lastBurst = -1e9;
  fixed.forEach((f, i) => {
    if (f.change) wishes.push({ id: `ramp${i}`, kind: "ramp", pieces: [{ fromMs: f.atMs - 700, toMs: f.atMs - frameMs }] });
    const kind = f.drops.length > 0 ? "dropBurst" : f.change && drops.length === 0 ? "lightBurst" : null;
    if (kind !== null && f.atMs - lastBurst >= 10_000) { wishes.push({ id: `burst${i}`, kind, pieces: [{ fromMs: f.atMs + frameMs, toMs: f.atMs + 250 }] }); lastBurst = f.atMs; }
  });
  // The beams are dark from each turn's first frame until they arrive (up to 3.5 s later, here a random arrival), at least 1 s + 1 frame; near turns join.
  const turns = [...songSweeps(song, 0, -10_000, lengthMs + 10_000), songChangeSweep(lengthMs)].map((s) => ({ startMs: s.fromMs, arrivalMs: s.fromMs + r.int(0, 3500) }));
  const windows = planSpans(turns, frameMs).map((s) => ({ fromMs: s.offMs, toMs: s.onMs, swayAfter: r.next() < 0.7 })); // a gather's and a fan's turns leave the look off the phase
  return { song, frameMs, wishes, marks: fixed.map((f) => f.atMs), windows, beatMs: 60_000 / bpm, lengthMs, switchAt: r.int(10_000, lengthMs - 5000) };
}

/** The beat is known where the link is locked or at Tempo only; coasting has none. A pair is the state before the link event and after it. */
function plan(t: Timeline, before: State, after: State): RunPlan {
  const beat: Span[] = [];
  if (before !== "coasting") beat.push({ fromMs: -1e9, toMs: t.switchAt });
  if (after !== "coasting") beat.push({ fromMs: t.switchAt + 2000, toMs: 1e9 });
  const turns = before === after ? [] : [t.switchAt + 2000];
  return fitRuns(t.wishes, { marks: t.marks, beat, count: [], beatMs: t.beatMs, endMs: t.lengthMs, frameMs: t.frameMs, sweepWindows: t.windows, unforeseenTurns: turns });
}

function check(seed: number, t: Timeline, before: State, after: State): RunPlan {
  const name = `seed ${seed}, ${before} to ${after}`;
  const p = plan(t, before, after);
  const decays = p.runs.filter((x) => isBurst(x.wish)).flatMap((x) => x.pieces.map((d) => ({ id: x.wish.id, d })));
  const others = p.runs.filter((x) => !isBurst(x.wish)).flatMap((x) => x.pieces);
  const least = minDarkMs(t.frameMs);
  for (const w of t.windows) {
    for (const o of others) assert.ok(!(o.fromMs < w.toMs + 1000 - TOL && w.fromMs - 1000 < o.toMs - TOL), `${name}: a run ${o.fromMs} to ${o.toMs} in the span ${w.fromMs} to ${w.toMs} or 1 s beside its steps`);
    for (const { id, d } of decays) {
      const c = cutSpan({ offMs: w.fromMs, onMs: w.toMs }, d, t.frameMs);
      assert.notEqual(c.kind, "overlaps", `${name}: the decay of ${id} lies in a span ${w.fromMs} to ${w.toMs}`);
      const cut = p.cuts.find((x) => x.id === id && x.planned === w);
      assert.equal(cut?.kind, c.kind === "clear" ? undefined : c.kind, `${name}: a step ${w.fromMs}/${w.toMs} near the decay ${d.fromMs}: ${c.kind}`);
      if (cut === undefined) assert.ok(w.toMs <= d.fromMs - least + TOL || w.fromMs >= d.toMs + 1000 - TOL, `${name}: a step within 1 s of a decay is not moved`);
      else {
        assert.deepEqual(cut.planned, w, `${name}: only light moves, the planned span is kept`);
        assert.ok(Math.abs((cut.kind === "b7" ? cut.onMs : cut.offMs) - (d.fromMs - t.frameMs)) < TOL, `${name}: the step goes into the rise frame`);
      }
    }
  }
  for (const { d } of decays) for (const o of others) assert.ok(gap(d, o) >= 1000 - TOL, `${name}: a run ${o.fromMs} to ${o.toMs} within 1 s of a decay ${d.fromMs}`);
  const counted: Span[] = [...t.marks.map((m) => ({ fromMs: m, toMs: m })), ...others];
  assert.ok(maxInASecond(counted) + 1 <= 3, `${name}: a window counts more than 3`);
  // A burst is skipped only for a cause.
  for (const w of p.skipped.filter(isBurst)) {
    const decay = w.pieces[0]!;
    const caused = t.windows.some((x) => cutSpan({ offMs: x.fromMs, onMs: x.toMs }, decay, t.frameMs).kind === "overlaps") || (before !== after && decay.toMs > t.switchAt + 1000 - TOL && decay.fromMs < t.switchAt + 2000 + 4150 + TOL)
      || others.some((o) => gap(o, decay) < 1000) || decays.some((x) => gap(x.d, decay) < 0) || t.marks.some((m) => m > decay.fromMs + TOL && m <= decay.toMs + TOL);
    assert.ok(caused, `${name}: ${w.id} is skipped for no cause`);
  }
  return p;
}

test(`link-state pairs: ${SEEDS} random songs through all 9 pairs keep every run out of the dark spans and 1 s from their steps, move a step near a decay into its rise frame, and skip a burst only for a cause`, () => {
  let placed = 0;
  let cut = 0;
  let skipped = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const t = timeline(seed);
    for (const a of STATES) for (const b of STATES) {
      const p = check(seed, t, a, b);
      placed += p.runs.filter((x) => isBurst(x.wish)).length;
      cut += p.cuts.length;
      skipped += p.skipped.filter(isBurst).length;
    }
  }
  assert.ok(placed > 200 && cut > 20 && skipped > 20, `the timelines hold bursts, cuts and skips: ${placed} placed, ${cut} cuts, ${skipped} skipped`);
});

test("a burst placed with the beat locked is placed coasting: the link adds runs to a window, never takes a place away", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const t = timeline(seed);
    const ids = (p: RunPlan) => new Set(p.runs.filter((x) => isBurst(x.wish)).map((x) => x.wish.id));
    const coasting = ids(plan(t, "coasting", "coasting"));
    for (const id of ids(plan(t, "locked", "locked"))) assert.ok(coasting.has(id), `seed ${seed}: ${id} is placed locked and not coasting`);
    for (const id of ids(plan(t, "tempo only", "tempo only"))) assert.ok(coasting.has(id), `seed ${seed}: ${id} is placed at Tempo only and not coasting`);
  }
});

test("the fan's turn starts 2250 ms after the drop's moment whatever P1 merges, and none for a drop less than 2.25 s before the song's end", () => {
  let turns = 0;
  let none = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { song, lengthMs } = timeline(seed);
    // A gather wins over a fan: only a drop with no other within 20 s has the turn to itself.
    for (const m of (song.moments ?? []).filter((x, _, all) => all.every((o) => o === x || Math.abs(o.at_ms - x.at_ms) > 20_000))) {
      let first: number | null = null;
      for (let p = m.at_ms; p < Math.min(lengthMs, m.at_ms + FAN_TURN_DELAY_MS + 50) && first === null; p++) if (turningMoments(song.moments, song.bpm, p, lengthMs).fan) first = p;
      const wanted = lengthMs - m.at_ms >= FAN_TURN_DELAY_MS ? m.at_ms + FAN_TURN_DELAY_MS : null;
      if (wanted === null || wanted >= lengthMs) { assert.equal(first, null, `seed ${seed}: a drop ${lengthMs - m.at_ms} ms before the end has no fan turn`); none++; continue; }
      assert.equal(first, wanted, `seed ${seed}: the fan's turn starts at the moment plus 2250 ms`);
      turns++;
    }
  }
  assert.ok(turns > 20 && none > 5, `${turns} turns and ${none} drops with none`);
});
