// The cut cases of the burst-decay gate (scene.md "The CI gate for a burst's decay", "the cut window"): a burst of each kind with its decay
// less than 1 s after the planned window of a phrase flip, a song change or a gather (0.1, 0.5 and 0.9 s), and less than 1 s before one's
// turn. Each is a generated class (demo/generated.ts) with the times worked out here, in class-clock milliseconds. Pure.
import { LOOKS } from "../../model/src/index.ts";
import { genName } from "../demo/generated.ts";
import type { GenSpec } from "../demo/generated.ts";
import { VARIANTS, feedAt } from "../demo/scenario.ts";
import { RigLoop } from "../src/loop.ts";
import { SONG_START_MS, phraseMs, phraseStartMs, specOf } from "./shared-cases.ts";
import type { Factors, STATES } from "./shared-cases.ts";
import { tokensFromFile } from "./tokens-file.ts";

export type BurstKind = "drop" | "light";
export type CutCause = "phrase flip" | "song change" | "gather" | "turn after";
export const CUT_CAUSES: readonly CutCause[] = ["phrase flip", "song change", "gather", "turn after"];
export const GAPS_MS = [100, 500, 900] as const;
const FRAME_MS = 1000 / 60;
/** `--scene-sweep-window` and the decay's own length, as the scheduler has them (model/src/sweeps.ts, render/src/budget-calc.ts). */
const WINDOW_MS = 4150;
const DECAY_MS = 250;
const GATHER_BEATS = 8;
const HOLD_STILL_MS = 1000;

export interface CutCase {
  readonly kind: BurstKind;
  readonly cause: CutCause;
  readonly gapMs: number;
  /** The time between the planned window and the decay that the case builds: the gap itself, or 1 s less it for a gather (the drop is `gapMs` after its frame). */
  readonly windowGapMs: number;
  readonly factors: Factors;
  readonly spec: GenSpec;
  /** The page plays from here to there (class clock, ms). */
  readonly fromMs: number;
  readonly toMs: number;
  /** The burst's decay (first and last frame), and the frames of the turn the cut took out of the counted window. */
  readonly decay: { readonly fromMs: number; readonly toMs: number };
  readonly away: { readonly fromMs: number; readonly toMs: number };
}

/** The zone an interval change goes to: the next row, or the one below the last, as a class steps (never from 7 to 1). */
const nextZone = (zone: number): number => (zone === 7 ? 6 : zone + 1);

/** The burst's frame for a decay that starts at `decayFromMs`: a drop's own moment, or the interval change a light-only burst rises on. */
function burstAt(kind: BurstKind, frameMs: number, f: Factors, startMs: number, tempoOnly: boolean, extra: Partial<GenSpec> = {}): GenSpec {
  const zone2 = nextZone(f.zone);
  return kind === "drop"
    ? specOf(f, tempoOnly, { startMs, moments: [{ at_ms: frameMs - startMs, kind: "drop" }], lengthMs: 400_000, ...extra })
    : specOf(f, tempoOnly, { startMs, changes: [{ atMs: frameMs, zone: zone2 }], lengthMs: 400_000, ...extra });
}

export function cutCase(kind: BurstKind, cause: CutCause, gapMs: number, f: Factors, tempoOnly: boolean): CutCase {
  const beat = 60_000 / f.bpm;
  let frameMs: number; // the burst's frame (the rise); its decay runs from the next frame for 250 ms
  let startMs = SONG_START_MS;
  let away: { fromMs: number; toMs: number };
  const flip = SONG_START_MS + phraseStartMs(f);
  if (cause === "phrase flip") {
    frameMs = flip + WINDOW_MS + gapMs - FRAME_MS;
    away = { fromMs: frameMs + FRAME_MS - 1000, toMs: flip + WINDOW_MS };
  } else if (cause === "song change") {
    startMs = SONG_START_MS + phraseStartMs(f); // a song of its own, started where the phrase would flip
    frameMs = startMs + WINDOW_MS + gapMs - FRAME_MS;
    away = { fromMs: frameMs + FRAME_MS - 1000, toMs: startMs + WINDOW_MS };
  } else if (cause === "gather") {
    // A drop merged onto an interval change `gapMs` before it: the gather's window ends 1 s before the moment, the frame is the change's.
    const moment = flip + WINDOW_MS + GATHER_BEATS * beat + 500;
    frameMs = moment - gapMs;
    away = { fromMs: frameMs + FRAME_MS - 1000, toMs: moment - HOLD_STILL_MS };
  } else {
    // The next phrase flip starts `gapMs` after the decay's last frame.
    const next = flip + phraseMs(f.bpm);
    frameMs = next - gapMs - DECAY_MS;
    away = { fromMs: next, toMs: frameMs + DECAY_MS + 1000 };
  }
  const spec = cause === "gather"
    ? { ...specOf(f, tempoOnly, { moments: [{ at_ms: frameMs + gapMs - SONG_START_MS, kind: "drop" }], changes: [{ atMs: frameMs, zone: nextZone(f.zone) }], lengthMs: 400_000 }) }
    : burstAt(kind, frameMs, f, startMs, tempoOnly);
  const decay = { fromMs: frameMs + FRAME_MS, toMs: frameMs + DECAY_MS };
  const [lo, hi] = [Math.min(decay.fromMs, away.fromMs), Math.max(decay.toMs, away.toMs)];
  return { kind, cause, gapMs, windowGapMs: cause === "gather" ? 1000 - gapMs + FRAME_MS : gapMs, factors: f, spec, fromMs: Math.round(lo - 1500), toMs: Math.round(hi + 1500), decay, away };
}

/** Whether the rig's own loop places the case's burst in `state` (no browser): what the S6 report says of a generated class. */
export function placedBy(c: CutCase, state: (typeof STATES)[number]): boolean {
  const loop = new RigLoop(tokensFromFile());
  const variant = VARIANTS[genName({ ...c.spec, tempoOnly: state.tempoOnly })]!;
  const link = state.name === "coasting" ? ({ state: "Coasting" } as const) : ({ state: "Locked" } as const);
  for (let ms = c.fromMs - 12_000, i = 0; ms < c.toMs; i++) {
    const d = loop.step(feedAt(ms, { link, variant }), i === 0 ? 0 : 1 / 60, "High");
    if (d.burst > 0) return true;
    ms += d.dtSeconds * 1000;
  }
  return false;
}

export const LOOK_OF = (c: CutCase): string => LOOKS[c.spec.songIndex % LOOKS.length]!;
