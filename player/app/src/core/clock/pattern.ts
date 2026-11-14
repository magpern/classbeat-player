// Beat-counted position patterns on the class clock (format 1.1, README "Format 1.1"):
// "8 up, 8 down". Pure: derived from the plan and a class time, no I/O.
import { spanIndexAt } from "./plan.ts";
import type { ClockPlan, SongBeat } from "./plan.ts";

type Position = "seated" | "standing";

export interface PatternView {
  /** False when no beat can be counted (no song, or no `bpm`): `position` is `positions[0]`, steady. */
  readonly counted: boolean;
  readonly position: Position;
  /** True while a `next_downbeat` pattern still waits for its first beat: `position` is held. */
  readonly holding: boolean;
  /** Index into `positions` of the current step; null when not counting or holding. */
  readonly stepIndex: number | null;
  /** Beat within the step, 1..n; null when not counting or holding. */
  readonly beat: number | null;
  /** Beats left in the step, this one included (n at beat 1, 1 at beat n). */
  readonly beatsLeft: number | null;
  /** The position of the next step (the pattern repeats); null when not counting. */
  readonly nextPosition: Position | null;
}

const EPS = 1e-9;
const MS_PER_MIN = 60_000;

/**
 * Beat coordinate at song time `u` (ms from the song window start): beats since the grid origin.
 * Without anchors the origin is the window start at the song's `bpm`. With anchors the grid is
 * aligned to them: each anchor starts a beat (the coordinate is an integer there) and its own
 * tempo runs until the next one; before the first anchor the song's `bpm` runs backwards from it.
 */
export function beatCoord(s: SongBeat, u: number): number {
  const a = s.anchors;
  if (a.length === 0) return (u * s.bpm) / MS_PER_MIN;
  if (u < a[0].atMs) return ((u - a[0].atMs) * s.bpm) / MS_PER_MIN;
  let base = 0;
  let k = 0;
  while (k + 1 < a.length && a[k + 1].atMs <= u) {
    base += Math.round(((a[k + 1].atMs - a[k].atMs) * a[k].bpm) / MS_PER_MIN);
    k += 1;
  }
  return base + ((u - a[k].atMs) * a[k].bpm) / MS_PER_MIN;
}

/** Song time of beat coordinate `c`, the inverse of `beatCoord`. */
function coordTime(s: SongBeat, c: number): number {
  const a = s.anchors;
  if (a.length === 0) return (c * MS_PER_MIN) / s.bpm;
  if (c < 0) return a[0].atMs + (c * MS_PER_MIN) / s.bpm;
  let base = 0;
  let k = 0;
  while (k + 1 < a.length) {
    const next = base + Math.round(((a[k + 1].atMs - a[k].atMs) * a[k].bpm) / MS_PER_MIN);
    if (next > c) break;
    base = next;
    k += 1;
  }
  return a[k].atMs + ((c - base) * MS_PER_MIN) / a[k].bpm;
}

/** The song window with a `bpm` holding class time `ms` (the last window at or past the end), or -1. */
function songAt(plan: ClockPlan, ms: number): number {
  const i = spanIndexAt(plan.songs, ms);
  if (i < 0 || !(ms < plan.songs[i].endMs || i === plan.songs.length - 1)) return -1;
  return plan.songBeats?.[i] ? i : -1;
}

/** Beats counted over class time [from, to], each song window by its own grid. */
function beatsBetween(plan: ClockPlan, from: number, to: number): number {
  let sum = 0;
  plan.songs.forEach((w, i) => {
    const sb = plan.songBeats?.[i];
    const lo = Math.max(from, w.startMs);
    const hi = Math.min(to, w.endMs);
    if (sb && hi > lo) sum += beatCoord(sb, hi - w.startMs) - beatCoord(sb, lo - w.startMs);
  });
  return sum;
}

/** The class time step 0 starts: the interval start, or the first beat at or after it. */
function patternStart(plan: ClockPlan, startMs: number, onBeat: boolean): number {
  const i = songAt(plan, startMs);
  const sb = plan.songBeats?.[i];
  if (!onBeat || i < 0 || !sb) return startMs;
  const w = plan.songs[i];
  const first = Math.ceil(beatCoord(sb, startMs - w.startMs) - EPS);
  return Math.min(w.startMs + coordTime(sb, first), w.endMs);
}

/**
 * The pattern state of the interval class time `classMs` is in, or null when that interval has
 * no pattern. The pattern repeats and is cut at the interval end (the time is held at the end).
 */
export function patternAt(plan: ClockPlan, classMs: number): PatternView | null {
  const idx = spanIndexAt(plan.intervals, classMs);
  const pat = plan.patterns?.[idx];
  if (!pat) return null;
  const iv = plan.intervals[idx];
  const t = Math.min(classMs, iv.endMs);
  const uncounted: PatternView = {
    counted: false,
    position: pat.positions[0],
    holding: false,
    stepIndex: null,
    beat: null,
    beatsLeft: null,
    nextPosition: null,
  };
  if (songAt(plan, t) < 0) return uncounted;
  const t0 = patternStart(plan, iv.startMs, pat.startOn === "next_downbeat");
  if (t < t0) return { ...uncounted, counted: true, position: pat.position, holding: true, nextPosition: pat.positions[0] };
  const cycle = pat.beats.reduce((x, y) => x + y, 0);
  const e = beatsBetween(plan, t0, t) + EPS;
  const inCycle = e - Math.floor(e / cycle) * cycle;
  let step = 0;
  let from = 0;
  while (step + 1 < pat.beats.length && inCycle >= from + pat.beats[step]) from += pat.beats[step++];
  const n = pat.beats[step];
  const beat = Math.min(n, Math.floor(inCycle - from) + 1);
  return {
    counted: true,
    position: pat.positions[step],
    holding: false,
    stepIndex: step,
    beat,
    beatsLeft: n - beat + 1,
    nextPosition: pat.positions[(step + 1) % pat.positions.length],
  };
}
