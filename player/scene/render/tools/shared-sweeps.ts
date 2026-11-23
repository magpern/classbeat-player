// The sweeps' CI matrix (scene.md "The CI check that a sweep makes at most 1"): the frame drawn with no scheduled change (no burst, ramp, dim,
// energy step, quality step or text step) and everything else, over the window of one case of each cause, at the look, zone row, phrase parity,
// tempo and quality level the case names, locked with the beat, at Tempo only and coasting where the cause exists in the state. Two turns that
// overlap are played at every offset between their first frames in steps of 250 ms. Pure: this builds the cases, tools/shared-shots.ts plays them.
import type { GenSpec } from "../demo/generated.ts";
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
const WINDOW_MS = 4150;
const HOLD_MS = 2000;
const MARGIN_MS = 500;
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

export function oneCase(cause: SweepCause, state: StateName, f: Factors): SweepCase {
  const tempoOnly = STATES.find((s) => s.name === state)!.tempoOnly;
  const flip = flipAt(f);
  const base = { cause, state, factors: f, name: `${cause}, ${f.look}, zone ${f.zone}, parity ${f.parity}, ${f.bpm} bpm, ${f.quality}` };
  const gatherAt = flip + WINDOW_MS + MARGIN_MS; // clear of the flip's window
  const drop = (at: number): GenSpec => specOf(f, tempoOnly, { moments: [{ at_ms: at - SONG_START_MS, kind: "drop" }], lengthMs: 400_000 });
  switch (cause) {
    case "phrase flip": return { ...base, spec: specOf(f, tempoOnly), fromMs: flip - MARGIN_MS, toMs: flip + WINDOW_MS + MARGIN_MS, events: [] };
    case "gather": return { ...base, spec: drop(momentFor(f, gatherAt)), fromMs: gatherAt - MARGIN_MS, toMs: momentFor(f, gatherAt) - 1000 + MARGIN_MS, events: [] };
    case "fan": {
      const m = momentFor(f, gatherAt);
      return { ...base, spec: drop(m), fromMs: m + 2250 - MARGIN_MS, toMs: m + 2250 + WINDOW_MS + MARGIN_MS, events: [] };
    }
    case "song change": return { ...base, spec: specOf(f, tempoOnly, { startMs: flip }), fromMs: flip - MARGIN_MS, toMs: flip + WINDOW_MS + MARGIN_MS, events: [] };
    case "seek": {
      const [t0, t1] = [flip + 5000, flip + phraseMs(f.bpm) + 5000]; // into the next phrase: the other parity, the other targets
      return { ...base, spec: specOf(f, tempoOnly), fromMs: t0 - MARGIN_MS, toMs: t1 + HOLD_MS + WINDOW_MS + MARGIN_MS, events: [{ atMs: t0, jumpMs: t1 }] };
    }
    case "lost lock": {
      const t0 = flip + 5000;
      return { ...base, spec: specOf(f, false), fromMs: t0 - MARGIN_MS, toMs: t0 + HOLD_MS + WINDOW_MS + MARGIN_MS, events: [{ atMs: t0, link: "coasting" }] };
    }
    case "regained lock": {
      const t0 = flip + 5000;
      return { ...base, spec: specOf(f, false), startsCoasting: true, fromMs: t0 - MARGIN_MS, toMs: t0 + HOLD_MS + WINDOW_MS + MARGIN_MS, events: [{ atMs: t0, link: "locked" }] };
    }
    case "resume": {
      // The pause freezes the flip's turn; the rest of it runs after the resume. The pause and the resume are user actions, scheduled changes (the
      // lights go down and come back over the resume ramp): the count starts 1.5 s after the resume, when they are done and the 2 s hold still runs.
      const [pause, resume] = [flip + 1000, flip + 2200];
      return { ...base, spec: specOf(f, false), fromMs: flip - MARGIN_MS, countFromMs: resume + 1500, toMs: resume + HOLD_MS + WINDOW_MS + MARGIN_MS, events: [{ atMs: pause, link: "paused" }, { atMs: resume, link: "base" }] };
    }
  }
}

/** A phrase flip and a gather whose first frames are `offsetMs` apart, the flip first or the gather first, at one look, row and tempo. */
export function overlapCase(offsetMs: number, gatherFirst: boolean, f: Factors): SweepCase {
  const flip = flipAt(f) + (gatherFirst ? offsetMs : 0);
  const gather = gatherFirst ? flipAt(f) : flipAt(f) + offsetMs;
  const m = momentFor(f, gather);
  const spec = specOf(f, false, { moments: [{ at_ms: m - SONG_START_MS, kind: "drop" }], lengthMs: 400_000 });
  const end = Math.max(flip + WINDOW_MS, gather + WINDOW_MS, 0);
  return { cause: "overlap", name: `flip and gather ${gatherFirst ? "-" : "+"}${offsetMs} ms (${f.look}, zone ${f.zone}, ${f.bpm} bpm)`, state: "locked", factors: f, spec, fromMs: Math.min(flip, gather) - MARGIN_MS, toMs: Math.min(end, m - 1000) + MARGIN_MS, events: [] };
}

export const overlapOffsets = (): number[] => Array.from({ length: Math.floor(WINDOW_MS / OVERLAP_STEP_MS) + 1 }, (_, k) => k * OVERLAP_STEP_MS);

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
