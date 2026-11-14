// The score: the class as a strip moving under a fixed "now" line (docs/design/room-2d.md,
// "Layout", "Fitting text"). Pure: positions in vw from class time, and which labels may be drawn
// at all. Whether a name fits whole beside its number is the browser's to say (the markup lets
// it wrap onto a hidden row); this module only decides what is offered.
import type { Class } from "./input.ts";
import { LANDSCAPE_SCALE } from "./score-scale.ts";
import type { ScoreScale } from "./score-scale.ts";

type Interval = Class["intervals"][number];
type Song = Class["songs"][number];

/** Where "now" is, as a share of the width. */
export const NOW_X = 25;
/** The score is six minutes wide: 1.5 behind "now", 4.5 ahead. */
export const SPAN_S = 360;
/** vw per second: 0.2778, the 0.28 vw per second of system.md, Motion. */
export const VW_PER_S = 100 / SPAN_S;
const PAD = 0.8;
/**
 * The part of an interval block that is still ahead of "now" (or the whole block, when it has not
 * begun) must be at least this wide to hold its number whole, at every supported size (the
 * narrowest case is 5:4). A narrower one is a neutral sliver: no zone colour, no number.
 */
export const MIN_BLOCK_W = 3;
/** A block that begins right of this has no room for its number inside the safe area. */
export const NUMBER_FITS_UNTIL = 91;
/** A song title is offered only when at least this much of the clip is visible for it. */
export const TITLE_MIN_W = 8;

export interface ScoreBlock {
  readonly zone: number;
  readonly left: number;
  readonly width: number;
  readonly padLeft: number | null;
  readonly padRight: number | null;
  readonly name: string;
}

export interface ScoreGone {
  readonly left: number;
  readonly width: number;
}

export interface ScoreClip {
  readonly left: number;
  readonly width: number;
  /** Width of four bars, for the phrase ticks; null without a tempo. */
  readonly phrase: number | null;
  readonly padLeft: number | null;
  readonly padRight: number | null;
  readonly title: string | null;
  /** "1st of 2": the recording is in the class twice; the title gives way to it, it never does. */
  readonly occurrence: string | null;
  readonly artist: string | null;
  readonly bpm: number | null;
}

export interface ScoreMoment {
  readonly left: number;
  readonly label: string;
}

export interface ScoreModel {
  /** The clock only guesses: "now" is dashed. */
  readonly unsure: boolean;
  /** Everything wholly in the past, one grey block: history, not information. */
  readonly gone: ScoreGone | null;
  /**
   * Blocks with too little room ahead of "now" for their number (a short interval to come, or the
   * last seconds of the current one): drawn neutral, never in a zone colour without its number.
   */
  readonly slivers: readonly ScoreGone[];
  readonly blocks: readonly ScoreBlock[];
  readonly clips: readonly ScoreClip[];
  readonly moments: readonly ScoreMoment[];
  /** The "End" mark, when the end of the class is on the score. */
  readonly endLeft: number | null;
}

export interface ScoreInput {
  readonly classMs: number;
  readonly lengthMs: number;
  readonly intervals: readonly Interval[];
  readonly songs: readonly Song[];
  readonly zoneName: (zone: number) => string;
  /** The recording is in the class more than once: the song indexes it could be, in order. */
  readonly ambiguity: readonly number[] | null;
  /** The layout's scale; the room's own (six minutes across) when absent. */
  readonly scale?: ScoreScale;
  readonly unsure: boolean;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The x position, in vw, of a class time. */
export function xAt(timeMs: number, classMs: number, vwPerS: number = VW_PER_S): number {
  return NOW_X + ((timeMs - classMs) / 1000) * vwPerS;
}

/**
 * How far the strip has moved left, in vw, since the score was laid out for `classMs`: continuous,
 * or in whole-second steps with reduced motion (system.md, Motion).
 */
export function scoreShiftVw(elapsedMs: number, reducedMotion: boolean, vwPerS: number = VW_PER_S): number {
  const s = Math.max(0, elapsedMs) / 1000;
  return (reducedMotion ? Math.floor(s) : s) * vwPerS;
}

export function ordinalText(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

export function songBpm(song: Song): number | null {
  return song.bpm ?? song.beat_anchors?.anchors[0]?.bpm ?? null;
}

function padsFor(left: number, right: number, safeRight: number): { padLeft: number | null; padRight: number | null } {
  // A label that began in the past stays just right of "now"; one that would cross the safe edge
  // is kept inside it.
  const padLeft = left < NOW_X ? r2(NOW_X - left + PAD) : null;
  const padRight = right > safeRight ? r2(right - safeRight) : null;
  return { padLeft, padRight };
}

function layoutIntervals(inp: ScoreInput): Pick<ScoreModel, "gone" | "slivers" | "blocks"> {
  const sc = inp.scale ?? LANDSCAPE_SCALE;
  const blocks: ScoreBlock[] = [];
  const slivers: ScoreGone[] = [];
  let goneLeft: number | null = null;
  let goneRight = 0;
  for (const iv of inp.intervals) {
    const left = xAt(iv.start_ms, inp.classMs, sc.vwPerS);
    const right = xAt(iv.start_ms + iv.length_ms, inp.classMs, sc.vwPerS);
    if (right <= 0 || left >= 100) continue;
    if (right <= NOW_X) {
      goneLeft = goneLeft === null ? left : Math.min(goneLeft, left);
      goneRight = Math.max(goneRight, right);
      continue;
    }
    const width = right - left;
    // A zone colour always carries its whole number (system.md, rule 2): a block with no room
    // for it ahead of "now", or before the safe edge, is not drawn in colour.
    if (right - Math.max(left, NOW_X) < sc.minBlockW) {
      slivers.push({ left: r2(left), width: r2(width) });
      continue;
    }
    if (left > sc.numberFitsUntil) continue;
    blocks.push({ zone: iv.zone, left: r2(left), width: r2(width), ...padsFor(left, right, sc.safeRight), name: inp.zoneName(iv.zone) });
  }
  const gone = goneLeft === null ? null : { left: r2(Math.max(goneLeft, -NOW_X)), width: r2(goneRight - Math.max(goneLeft, -NOW_X)) };
  return { gone, slivers, blocks };
}

function clipFor(song: Song, index: number, inp: ScoreInput): ScoreClip | null {
  const sc = inp.scale ?? LANDSCAPE_SCALE;
  const left = xAt(song.start_ms, inp.classMs, sc.vwPerS);
  const right = xAt(song.end_ms, inp.classMs, sc.vwPerS);
  if (right <= 0 || left >= 100) return null;
  const bpm = songBpm(song);
  const phrase = bpm ? r3(((16 * 60) / bpm) * sc.vwPerS) : null;
  const base = { left: r2(left), width: r2(right - left), phrase };
  // Wholly past: history, no label. Beginning past the visible room for a title: no label.
  const room = Math.min(right, sc.safeRight) - Math.max(left, NOW_X) - 2 * PAD;
  if (right <= NOW_X || room < TITLE_MIN_W) return { ...base, padLeft: null, padRight: null, title: null, occurrence: null, artist: null, bpm: null };
  const nth = inp.ambiguity ? inp.ambiguity.indexOf(index) : -1;
  return {
    ...base,
    ...padsFor(left, right, sc.safeRight),
    title: song.title,
    occurrence: nth >= 0 && inp.ambiguity ? `${ordinalText(nth + 1)} of ${inp.ambiguity.length}` : null,
    artist: nth >= 0 ? null : song.artist,
    bpm: song.bpm ?? null,
  };
}

function layoutSongs(inp: ScoreInput): { clips: ScoreClip[]; moments: ScoreMoment[] } {
  const sc = inp.scale ?? LANDSCAPE_SCALE;
  const clips: ScoreClip[] = [];
  const moments: ScoreMoment[] = [];
  inp.songs.forEach((song, i) => {
    const clip = clipFor(song, i, inp);
    if (clip) clips.push(clip);
    // "No moments" means no marks: a missing quality is not drawn.
    const m = song.moments;
    if (!m || m.quality === "missing") return;
    for (const item of m.items) {
      const x = xAt(song.start_ms + item.at_ms, inp.classMs, sc.vwPerS);
      if (x >= NOW_X && x <= sc.momentUntil) moments.push({ left: r2(x), label: momentLabel(item.kind) });
    }
  });
  return { clips, moments };
}

function momentLabel(kind: "drop" | "breakdown" | "build" | "other"): string {
  return { drop: "Drop", breakdown: "Breakdown", build: "Build", other: "Moment" }[kind];
}

export function layoutScore(inp: ScoreInput): ScoreModel {
  const endX = xAt(inp.lengthMs, inp.classMs, (inp.scale ?? LANDSCAPE_SCALE).vwPerS);
  // The mark's label sits 1 vw right of it: it needs the safe area on both sides.
  const endLeft = endX >= 4 && endX <= 90 ? r2(endX) : null;
  return { unsure: inp.unsure, ...layoutIntervals(inp), ...layoutSongs(inp), endLeft };
}
