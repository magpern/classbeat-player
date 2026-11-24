// The sweeps' CI matrix (scene.md "The CI check that a sweep makes at most 1"): the frame drawn with no scheduled change (no burst, ramp, dim,
// energy step, quality step or text step) and everything else, in every 1 s window that overlaps the span from 1 s before a dark span's off-step to
// 1 s after its on-step, at the look, zone row, phrase parity, tempo and quality level the case names, locked with the beat, at Tempo only and
// coasting where the cause exists in the state. Two turns that overlap or nearly meet are played at every offset between their first frames in
// steps of 250 ms across the first's span and on to its on-step plus 2 s, and a frame each side of the join point. Pure: this builds the cases,
// tools/shared-shots.ts plays them.
import type { DarkSpan } from "../../model/src/index.ts";
import { minDarkMs } from "../../model/src/index.ts";
import type { GenSpec } from "../demo/generated.ts";
import { genName } from "../demo/generated.ts";
import { VARIANTS, feedAt } from "../demo/scenario.ts";
import { songSpans } from "../src/dark-calc.ts";
import { SONG_START_MS, STATES, lookByZone, phraseMs, phraseStartMs, specOf } from "./shared-cases.ts";
import type { Factors, StateName } from "./shared-cases.ts";

export type SweepCause = "phrase flip" | "gather" | "fan" | "song change" | "seek" | "lost lock" | "regained lock" | "resume";
/** Which states each cause exists in: a phrase flip needs the Beat level, a lock lost or regained needs the lock, the rest run in every state. */
export const CAUSE_STATES: Readonly<Record<SweepCause, readonly StateName[]>> = {
  "phrase flip": ["locked"],
  gather: ["locked", "tempo only", "coasting"],
  fan: ["locked", "tempo only", "coasting"],
  "song change": ["locked", "tempo only", "coasting"],
  seek: ["locked", "coasting"],
  "lost lock": ["locked"],
  "regained lock": ["locked"], // the state it ends in; the page starts coasting
  resume: ["locked"],
};
export const OVERLAP_STEP_MS = 250;
const FRAME_MS = 1000 / 60;
const HOLD_MS = 2000;
const AROUND_MS = 1100; // the count looks 1 s before the off-step and 1 s after the on-step, and a little more to hold the steps' own windows
const LONGEST_TURN_MS = 3500;
const PER_CAUSE_STATE = 2;

export interface SweepCase {
  readonly cause: SweepCause | "overlap";
  readonly name: string;
  readonly state: StateName;
  readonly factors: Factors;
  readonly spec: GenSpec;
  /** The page starts coasting (a lock regained). */
  readonly startsCoasting?: boolean;
  readonly fromMs: number;
  /** Where the count starts, when the run must begin earlier (a pause and a resume before it). */
  readonly countFromMs?: number;
  readonly toMs: number;
  readonly events: readonly { readonly atMs: number; readonly link?: string; readonly jumpMs?: number }[];
}

/** The class-clock time of the first phrase flip of the case's parity: the sweep every case is placed against. */
const flipAt = (f: Factors): number => SONG_START_MS + phraseStartMs(f);
/** A drop's moment such that its gather's turn starts at `gatherMs`: 8 beats before it, plus the 650 ms delay. */
const momentFor = (f: Factors, gatherMs: number): number => gatherMs - 650 + (8 * 60_000) / f.bpm;

/** The planned span the turn that starts at `startMs` is in, from the song's plan. */
export function spanOf(spec: GenSpec, startMs: number): DarkSpan {
  const variant = VARIANTS[genName(spec)]!;
  const feed = feedAt(startMs + 1, { variant });
  const spans = songSpans({ cls: variant.cls, songIndex: feed.songIndex, songPosMs: feed.songPosMs, classMs: startMs + 1 });
  return spans.find((s) => s.offMs <= startMs + 1 && startMs < s.onMs) ?? { offMs: startMs, onMs: startMs + minDarkMs(FRAME_MS), lastStartMs: startMs };
}

/** A case's stretch: from 1 s before the span's off-step to 1 s after its on-step, with a little more. */
const around = (span: DarkSpan): { fromMs: number; toMs: number } => ({ fromMs: Math.round(span.offMs - AROUND_MS), toMs: Math.round(span.onMs + AROUND_MS) });

export function oneCase(cause: SweepCause, state: StateName, f: Factors): SweepCase {
  const tempoOnly = STATES.find((s) => s.name === state)!.tempoOnly;
  const flip = flipAt(f);
  const base = { cause, state, factors: f, name: `${cause}, ${f.look}, zone ${f.zone}, parity ${f.parity}, ${f.bpm} bpm, ${f.quality}` };
  const gatherAt = flip + 5000 + (8 * 60_000) / f.bpm; // clear of the flip's span and its hold
  const drop = (at: number): GenSpec => specOf(f, tempoOnly, { moments: [{ at_ms: at - SONG_START_MS, kind: "drop" }], lengthMs: 400_000 });
  switch (cause) {
    case "phrase flip": { const spec = specOf(f, tempoOnly, { lengthMs: 400_000 }); return { ...base, spec, ...around(spanOf(spec, flip)), events: [] }; }
    case "gather": {
      const m = momentFor(f, gatherAt);
      const spec = drop(m);
      const stretch = around(spanOf(spec, gatherAt));
      return { ...base, spec, ...stretch, toMs: Math.min(stretch.toMs, Math.round(m - 100)), events: [] }; // the drop's burst is a scheduled change: the count ends before it
    }
    case "fan": {
      const m = momentFor(f, gatherAt);
      const spec = drop(m);
      return { ...base, spec, ...around(spanOf(spec, m + 2250)), events: [] };
    }
    case "song change": { const spec = specOf(f, tempoOnly, { startMs: flip, lengthMs: 400_000 }); return { ...base, spec, ...around(spanOf(spec, flip)), events: [] }; }
    case "seek": {
      const [t0, t1] = [flip + 5000, flip + phraseMs(f.bpm) + 5000]; // into the next phrase: the other parity, the other targets
      return { ...base, spec: specOf(f, tempoOnly), fromMs: t0 - 500, toMs: t1 + HOLD_MS + LONGEST_TURN_MS + AROUND_MS, events: [{ atMs: t0, jumpMs: t1 }] };
    }
    case "lost lock": {
      const t0 = flip + 5000;
      return { ...base, spec: specOf(f, false), fromMs: t0 - 500, toMs: t0 + HOLD_MS + LONGEST_TURN_MS + AROUND_MS, events: [{ atMs: t0, link: "coasting" }] };
    }
    case "regained lock": {
      const t0 = flip + 5000;
      return { ...base, spec: specOf(f, false), startsCoasting: true, fromMs: t0 - 500, toMs: t0 + HOLD_MS + LONGEST_TURN_MS + AROUND_MS, events: [{ atMs: t0, link: "locked" }] };
    }
    case "resume": {
      // The pause freezes the flip's turn; the rest of it runs after the resume. The pause and the resume are user actions, scheduled changes (the
      // lights go down and come back over the resume ramp): the count starts 1.5 s after the resume, when they are done and the 2 s hold still runs.
      const [pause, resume] = [flip + 1000, flip + 2200];
      return { ...base, spec: specOf(f, false), fromMs: flip - 500, countFromMs: resume + 1500, toMs: resume + HOLD_MS + LONGEST_TURN_MS + AROUND_MS, events: [{ atMs: pause, link: "paused" }, { atMs: resume, link: "base" }] };
    }
  }
}

/** The offsets between two turns' first frames: every 250 ms across the first's span and on to its on-step plus 2 s, and a frame each side of the join point (the gap of 1 s + 1 frame). */
export function overlapOffsets(spanMs: number): number[] {
  const join = spanMs + minDarkMs(FRAME_MS); // the second turn's off-step this long after the first's: the gap is then 1 s + 1 frame and the spans stay apart
  const grid = Array.from({ length: Math.floor((spanMs + 2000) / OVERLAP_STEP_MS) + 1 }, (_, k) => k * OVERLAP_STEP_MS);
  return [...new Set([...grid, join - 2 * FRAME_MS, join - FRAME_MS, join, join + FRAME_MS, join + 2 * FRAME_MS].map((x) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
}

/** A phrase flip and a gather whose first frames are `offsetMs` apart, the flip first or the gather first, at one look, row and tempo. */
export function overlapCase(offsetMs: number, gatherFirst: boolean, f: Factors): SweepCase {
  const flip = flipAt(f) + (gatherFirst ? offsetMs : 0);
  const gather = gatherFirst ? flipAt(f) : flipAt(f) + offsetMs;
  const m = momentFor(f, gather);
  const spec = specOf(f, false, { moments: [{ at_ms: m - SONG_START_MS, kind: "drop" }], lengthMs: 400_000 });
  const spans = [spanOf(spec, Math.min(flip, gather)), spanOf(spec, Math.max(flip, gather))];
  const [lo, hi] = [Math.min(...spans.map((s) => s.offMs)), Math.max(...spans.map((s) => s.onMs))];
  return { cause: "overlap", name: `flip and gather ${gatherFirst ? "-" : "+"}${offsetMs} ms (${f.look}, zone ${f.zone}, ${f.bpm} bpm)`, state: "locked", factors: f, spec, ...around({ offMs: lo, onMs: hi, lastStartMs: lo }), toMs: Math.min(around({ offMs: lo, onMs: hi, lastStartMs: lo }).toMs, Math.round(m - 100)), events: [] };
}

/** The first span's length for the overlap grid: a phrase flip's, at the case's own tempo and look. */
export function firstSpanMs(f: Factors): number {
  const spec = specOf(f, false, { lengthMs: 400_000 });
  const s = spanOf(spec, flipAt(f));
  return s.onMs - s.offMs;
}

/** Every cause in each state it exists in, `PER_CAUSE_STATE` cases of balanced factors each; the pool strides so the union covers every look, zone, tempo and quality level. */
export function sweepCases(pool: readonly Factors[] = lookByZone()): SweepCase[] {
  const out: SweepCase[] = [];
  let n = 0;
  for (const cause of Object.keys(CAUSE_STATES) as SweepCause[]) for (const state of CAUSE_STATES[cause]) for (let k = 0; k < PER_CAUSE_STATE; k++) {
    // A lock lost or regained mid-phrase needs a mirrored one to turn; a song change a look other than the first song's.
    const mine = pool.filter((f) => (cause === "lost lock" || cause === "regained lock" ? f.parity === 1 : true) && (cause === "song change" ? f.look !== "fan" : true));
    out.push(oneCase(cause, state, mine[(n++ * 11 + 4) % mine.length]!));
  }
  return out;
}
