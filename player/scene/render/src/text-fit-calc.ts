// The fitting rules of scene.md ("Fitting"), as numbers: which layout, whether a zone name steps
// down, whether a pattern block folds into the Position metric. Widths are estimates from the
// faces' average glyph widths (shares of the font size); the browser run measures the real ink
// (S15, S16) and fails if an estimate is wrong. Pure.

import type { LayoutKind } from "./text-view.ts";

/** 3:2 and narrower use the narrow layout (scene.md "Layout"). */
export const NARROW_UP_TO = 1.5;
export const layoutFor = (aspect: number): LayoutKind => (aspect > NARROW_UP_TO ? "wide" : "narrow");

/** Average glyph widths as a share of the font size: the number face (digits, capitals) and the text face. */
export const NUMBER_EM = 0.44;
export const TEXT_EM = 0.56;

/** A width in vw for `chars` glyphs at `sizeVh`, on a window `aspect` wide over high (1 vh is 1/aspect vw). */
export const widthVw = (chars: number, sizeVh: number, aspect: number, em: number): number => (chars * em * sizeVh) / aspect;

/** Greedy word wrap by a character budget: the lines a text takes (a longer word takes a line of its own). */
export function wrapLines(text: string, maxChars: number): number {
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    const need = used === 0 ? word.length : used + 1 + word.length;
    if (need <= maxChars || used === 0) used = need;
    else { lines++; used = word.length; }
  }
  return lines;
}

/** The cue steps down from `--t-text` to `--t-text-min` over 60 characters (room-2d.md). */
export const cueSmall = (text: string): boolean => text.length > 60;

/**
 * A zone name that cannot keep two lines at the full size steps to the minor tier (scene.md
 * "Layout"), as does one with a word wider than the line (it would break in the middle). The
 * gel's name has 17.5 vw to write in at 16:9 and wider (24 vw, less its padding), 24 vw narrower.
 */
export function nameSmall(name: string, layout: LayoutKind, aspect: number): boolean {
  const sizeVh = layout === "wide" ? Math.min(7.6, 4.4 * aspect) : 7.3;
  const inner = layout === "wide" ? 17.5 : 24;
  const budget = Math.floor(inner / widthVw(1, sizeVh, aspect, NUMBER_EM));
  return wrapLines(name, budget) > 2 || name.split(/\s+/).some((w) => w.length > budget);
}

export interface NextFitInput {
  readonly layout: LayoutKind;
  readonly aspect: number;
  readonly zoneName: string;
  readonly length: string;
  /** The spec's forms, longest first (`specForms`). */
  readonly specs: readonly string[];
  /** The Song metric above it, which the row keeps clear of (wide layout only). */
  readonly song: { readonly label: string; readonly value: string; readonly unit: string | null };
}

export interface NextFit {
  readonly leftVw: number;
  readonly sizeVh: number;
  readonly spec: string | null;
}

const NEXT_SIZES_VH = [4.6, 4.5];

/**
 * The next row's first line is one line (scene.md "Fitting"): the longest spec that fits its width
 * at 4.6 vh, then at 4.5 vh (cap 3 %); a row too long for both keeps the number, name and length and
 * drops the spec's cadence, then the whole spec (the next cue is always shown).
 */
export function fitNextRow(i: NextFitInput): NextFit {
  const wide = i.layout === "wide";
  const metricW = Math.max(widthVw(i.song.value.length, 7.6, i.aspect, NUMBER_EM) + widthVw((i.song.unit?.length ?? 0) + 1, 4.6, i.aspect, TEXT_EM), widthVw(i.song.label.length, 3.1, i.aspect, TEXT_EM));
  const leftVw = wide ? 27 + metricW + 2 : 5;
  const avail = 95 - leftVw;
  const fixed = (size: number): number =>
    widthVw(5 + i.zoneName.length, size, i.aspect, TEXT_EM) + widthVw(i.length.length, size, i.aspect, NUMBER_EM) + widthVw(2, size, i.aspect, NUMBER_EM) + 4;
  for (const size of NEXT_SIZES_VH) {
    const spec = i.specs.find((s) => fixed(size) + widthVw(s.length + 1, size, i.aspect, TEXT_EM) <= avail);
    if (spec !== undefined) return { leftVw, sizeVh: size, spec };
  }
  return { leftVw, sizeVh: 4.6, spec: null };
}

const CUE_LINE = 1.04;
const NEXT_CUE_LINE = 3.1 * 1.1;

/** Lines the current cue takes: two at --t-text, three at --t-text-min (over 60 characters), the box growing up from its bottom edge. */
export function cueLines(text: string, layout: LayoutKind, aspect: number): number {
  const small = cueSmall(text) || layout === "narrow";
  const perLine = Math.floor((layout === "wide" ? 68 : 90) / widthVw(1, small ? 4.6 : 5.4, aspect, TEXT_EM));
  return Math.min(small ? 3 : 2, wrapLines(text, perLine));
}

export interface NextCueInput {
  readonly layout: LayoutKind;
  readonly aspect: number;
  readonly currentCue: string;
  readonly nextCue: string;
  /** The row's first line size (vh). */
  readonly lineVh: number;
}

/**
 * How many lines of the next cue the row has: as many as its text needs up to 3 (2 narrower),
 * while its ink ends 1.5 vh above the current cue's first line (scene.md "Fitting"). 0 leaves the
 * line out, as room-2d.md does for a cue that fills the room above the row.
 */
export function nextCueLines(i: NextCueInput): number {
  const wide = i.layout === "wide";
  const small = cueSmall(i.currentCue) || !wide;
  const cueTop = (wide ? 68.4 : 80.3) - cueLines(i.currentCue, i.layout, i.aspect) * (small ? 4.6 : 5.4) * CUE_LINE;
  const rowTop = (wide ? 39.8 : 52.5) + i.lineVh * 1.1 + 1;
  const room = Math.floor((cueTop - 1.5 - rowTop) / NEXT_CUE_LINE);
  const need = wrapLines(i.nextCue, Math.floor((wide ? 52 : 90) / widthVw(1, 3.1, i.aspect, TEXT_EM)));
  return Math.max(0, Math.min(wide ? 3 : 2, need, room));
}

export interface FoldInput {
  readonly aspect: number;
  /** Glyphs of the countdown at its widest in this interval (5 from 10 minutes). */
  readonly countGlyphs: number;
  /** The widest cadence or song value, in glyphs, and its unit's. */
  readonly valueGlyphs: number;
  readonly unitGlyphs: number;
}

/** The block needs 16 vw between the widest metric value and the countdown, else it folds (decided once per interval). */
export function patternRoom(i: FoldInput): number {
  const metricsRight = 27 + widthVw(i.valueGlyphs, 7.6, i.aspect, NUMBER_EM) + widthVw(i.unitGlyphs + 1, 4.6, i.aspect, TEXT_EM);
  const left = Math.max(46, metricsRight + 2);
  const countLeft = 95 - widthVw(i.countGlyphs, 26, i.aspect, NUMBER_EM);
  return countLeft - 2 - left;
}

export const MIN_PATTERN_ROOM_VW = 16;
export const foldsPattern = (i: FoldInput): boolean => patternRoom(i) < MIN_PATTERN_ROOM_VW;
