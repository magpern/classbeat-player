// The cut cases of the burst-decay gate (scene.md "The CI gate for a burst's decay", "the cut window", "A burst cuts a sweep's window"): a burst of each
// kind with its decay less than 1 s + 1 frame after the on-step of a phrase flip, a song change or a gather (0.1, 0.5 and 0.9 s: B7, the light comes on
// in the rise frame), and less than 1 s before one's turn (B8: the beams go dark in the rise frame). Each is a generated class (demo/generated.ts) with
// the times worked out from the plan of the dark spans (render/src/dark-calc.ts), in class-clock milliseconds. Pure apart from the loop `placedBy` runs.
import { LOOKS, cutSpan } from "../../model/src/index.ts";
import type { DarkSpan } from "../../model/src/index.ts";
import { genName } from "../demo/generated.ts";
import type { GenSpec } from "../demo/generated.ts";
import { VARIANTS, feedAt } from "../demo/scenario.ts";
import { songSpans, swayNearDecay } from "../src/dark-calc.ts";
import { RigLoop } from "../src/loop.ts";
import { SONG_START_MS, phraseMs, phraseStartMs, specOf } from "./shared-cases.ts";
import type { Factors, STATES } from "./shared-cases.ts";
import { tokensFromFile } from "./tokens-file.ts";

export type BurstKind = "drop" | "light";
export type CutCause = "phrase flip" | "song change" | "gather" | "turn after";
export const CUT_CAUSES: readonly CutCause[] = ["phrase flip", "song change", "gather", "turn after"];
export const GAPS_MS = [100, 500, 900] as const;
const FRAME_MS = 1000 / 60;
const DECAY_MS = 250;
const GATHER_BEATS = 8;

export interface CutCase {
  readonly kind: BurstKind;
  readonly cause: CutCause;
  readonly gapMs: number;
  readonly factors: Factors;
  readonly spec: GenSpec;
  /** The page plays from here to there (class clock, ms). */
  readonly fromMs: number;
  readonly toMs: number;
  /** The burst's decay (first and last frame), the rise frame before it, and the dark span as the burst leaves it (B7: off-step to the rise frame; B8: the rise frame to the on-step). */
  readonly decay: { readonly fromMs: number; readonly toMs: number };
  readonly span: { readonly offMs: number; readonly onMs: number };
  /** What the burst does to the span the case is built around. */
  readonly step: "b7" | "b8" | "clear" | "overlaps";
  /** At the Beat level and Tempo only the looks' sway is live within 1 s of the decay: steps e and f skip the burst there, and record it (the spec's own skip; at the None level none). */
  readonly swayNear: boolean;
  /** A light-only burst whose cut is a B8 gives way at every level: its on-step is in the hold planned without it (`lightB8InHold`). */
  readonly holdSkip: boolean;
}

/**
 * The zone an interval change goes to: the same row. A step to another zone brings the hue wipe of its anticipation (10 s of it, S5: constant
 * luminance by design, a few percent on a dark region) and its energy, scheduled changes of their own that the strict whole-frame gate holds
 * (S6); these cases isolate what the burst does to a dark span.
 */
const nextZone = (zone: number): number => zone;

/** Whether the sway is live within 1 s of a decay in a spec's class (at the Beat level and Tempo only the burst is skipped there). */
function swayNearAt(spec: GenSpec, decay: { fromMs: number; toMs: number }): boolean {
  const variant = VARIANTS[genName(spec)]!;
  const feed = feedAt(decay.fromMs, { variant });
  const w = { cls: variant.cls, songIndex: feed.songIndex, songPosMs: feed.songPosMs, classMs: decay.fromMs };
  return swayNearDecay(w, songSpans(w), decay);
}

/** The spans the plan gives for a spec, around `atMs`. */
function plan(spec: GenSpec, atMs: number): DarkSpan[] {
  const variant = VARIANTS[genName(spec)]!;
  const feed = feedAt(atMs, { variant });
  return songSpans({ cls: variant.cls, songIndex: feed.songIndex, songPosMs: feed.songPosMs, classMs: atMs });
}
const spanAt = (spans: readonly DarkSpan[], atMs: number): DarkSpan | undefined => spans.find((s) => s.offMs <= atMs + 1 && atMs < s.onMs + 1);

function burstSpec(kind: BurstKind, frameMs: number, f: Factors, startMs: number, tempoOnly: boolean): GenSpec {
  return kind === "drop"
    ? specOf(f, tempoOnly, { startMs, moments: [{ at_ms: frameMs - startMs, kind: "drop" }], lengthMs: 400_000 })
    : specOf(f, tempoOnly, { startMs, changes: [{ atMs: frameMs, zone: nextZone(f.zone) }], lengthMs: 400_000 });
}

export function cutCase(kind: BurstKind, cause: CutCause, gapMs: number, f: Factors, tempoOnly: boolean): CutCase {
  const beat = 60_000 / f.bpm;
  const flip = SONG_START_MS + phraseStartMs(f);
  let frameMs: number; // the burst's frame (the rise); its decay runs from the next frame for 250 ms
  let startMs = SONG_START_MS;
  let spec: GenSpec;
  let around: number; // a time inside the span the case is built around
  if (cause === "phrase flip" || cause === "song change") {
    if (cause === "song change") startMs = flip; // a song of its own, started where the phrase would flip
    const base = specOf(f, tempoOnly, { startMs, lengthMs: 400_000 });
    const on = spanAt(plan(base, flip + 500), flip + 500)?.onMs ?? flip + 3500;
    frameMs = on + gapMs - FRAME_MS; // the decay's first frame is `gapMs` after the on-step
    spec = burstSpec(kind, frameMs, f, startMs, tempoOnly);
    around = flip + 500;
  } else if (cause === "gather") {
    // A drop merged onto an interval change `gapMs` before it: the gather's beams hold still, and the light is back, 1 s before the moment.
    const moment = flip + 3500 + GATHER_BEATS * beat + 500;
    frameMs = moment - gapMs;
    spec = specOf(f, tempoOnly, { moments: [{ at_ms: moment - SONG_START_MS, kind: "drop" }], changes: [{ atMs: frameMs, zone: nextZone(f.zone) }], lengthMs: 400_000 });
    around = moment - 8 * beat + 1000;
  } else {
    // The next phrase flip starts `gapMs` after the decay's last frame (B8).
    const next = flip + phraseMs(f.bpm);
    frameMs = next - gapMs - DECAY_MS;
    spec = burstSpec(kind, frameMs, f, startMs, tempoOnly);
    around = next + 500;
  }
  const decay = { fromMs: frameMs + FRAME_MS, toMs: frameMs + DECAY_MS };
  const found = spanAt(plan(spec, around), around); // none at Tempo only: no anchors, no flips
  const span = found ?? { offMs: around, onMs: around + 1000 };
  const cut = found === undefined ? { kind: "clear" as const } : cutSpan(span, decay, FRAME_MS);
  const shown = cut.kind === "b7" ? { offMs: span.offMs, onMs: cut.onMs } : cut.kind === "b8" ? { offMs: cut.offMs, onMs: cut.onMs } : { offMs: span.offMs, onMs: span.onMs };
  const [lo, hi] = [Math.min(decay.fromMs, shown.offMs), Math.max(decay.toMs, shown.onMs)];
  return { kind, cause, gapMs, factors: f, spec, fromMs: Math.round(lo - 2500), toMs: Math.round(hi + 2500), decay, span: shown, step: cut.kind, swayNear: swayNearAt(spec, decay), holdSkip: kind === "light" && cut.kind === "b8" };
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
