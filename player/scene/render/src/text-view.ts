// What the text layer draws, decided: every string, size class and position, so the DOM code only
// places it (the web room screen's `RoomModel`, for the scene). Types only.

import type { PatternState } from "./text-pattern-calc.ts";

export type LayoutKind = "wide" | "narrow";

export interface GelView {
  readonly zone: number;
  /** `down`: lights down (paused), the colour moves into the numeral. */
  readonly look: "zone" | "down";
  readonly numeral: string;
  readonly name: string;
  /** The name could not keep two lines at the full size, so it steps to the minor tier. */
  readonly nameSmall: boolean;
  readonly targets: readonly string[];
}

export interface RailView {
  /** Null before the start: as on the plain screen, the rail then holds the link line alone, so its longest words (swedebeat.md W2) have the whole rail. */
  readonly left: string | null;
  readonly done: string | null;
  readonly segment: string | null;
  readonly link: { readonly text: string; readonly alert: boolean };
  /** The shape of the link marker (named `kind`, a member the layer may read) (scene.md "Link markers in the text layer"). */
  readonly kind: "round" | "square" | "ring";
}

export interface ClockView {
  readonly label: string;
  /** The compact "Paused" plate in place of the label. */
  readonly paused: boolean;
  readonly bars: string | null;
  readonly count: string;
  /** The interval's countdown has five glyphs (10 minutes or more). */
  readonly wide: boolean;
  /** The clock only guesses: dimmed marks are a dashed rule, never a dimmer colour. */
  readonly estimated: boolean;
  readonly pauseLine: string | null;
}

export interface MetricView {
  readonly key: "cadence" | "position" | "target" | "song";
  readonly label: string;
  readonly value: string;
  readonly unit: string | null;
  /** The Position metric of a folded pattern: side and count, or a note. */
  readonly folded: PatternState | null;
}

export interface PatternBlockView {
  readonly label: string;
  readonly state: PatternState;
  /** Squares for the beats of this side (8 or fewer), filled for the beats left. */
  readonly squares: { readonly total: number; readonly left: number } | null;
  /** The count steps down to a smaller size where the countdown crowds the block. */
  readonly compact: boolean;
}

export interface NextView {
  readonly end: boolean;
  readonly zone: number;
  readonly zoneName: string;
  readonly length: string;
  readonly spec: string | null;
  readonly cue: string | null;
  /** Where the row starts (vw) and its first line's size (vh): fitted to the room it has. */
  readonly leftVw: number;
  readonly sizeVh: number;
  /** Lines the next cue may take above the current cue (0: left out). */
  readonly cueLines: number;
}

export interface CueView {
  readonly text: string;
  /** Over 60 characters: `--t-text-min`, three lines. */
  readonly small: boolean;
}

export type BlockKind = "past" | "zone" | "neutral";

export interface IntervalBlock {
  readonly key: string;
  readonly zone: number;
  readonly kind: BlockKind;
  readonly x0: number;
  readonly x1: number;
  readonly textLeft: number;
  readonly textRight: number;
  readonly number: string | null;
  readonly length: string | null;
  readonly name: string | null;
  /** The second line: the pattern in words, then the cue. */
  readonly detail: string | null;
  /** The pattern's beat strip, where the grid is known. */
  readonly strip: Strip | null;
}

export interface Strip {
  /** Width of one cycle of the pattern, in vw, and where the first one starts relative to the block's left edge. */
  readonly cycleVw: number;
  readonly offsetVw: number;
  /** Fractions of a cycle, `up` where the room is standing. */
  readonly parts: readonly StripPart[];
}

/** A stretch of one cycle of the strip, as fractions of the cycle. */
export interface StripPart {
  readonly from: number;
  readonly to: number;
  readonly up: boolean;
}

export interface SongClip {
  readonly key: string;
  readonly x0: number;
  readonly x1: number;
  readonly textLeft: number;
  readonly textRight: number;
  readonly title: string;
  /** Artist and tempo, when they fit after the title. */
  readonly detail: string | null;
  readonly moments: readonly { readonly x: number; readonly word: string }[];
  readonly ticks: readonly number[];
}

export interface ScoreView {
  readonly nowX: number;
  readonly aheadMin: number;
  readonly intervals: readonly IntervalBlock[];
  readonly songs: readonly SongClip[];
  /** The "End" mark's x, when the class ends inside the window. */
  readonly endX: number | null;
}

export interface TextView {
  readonly layout: LayoutKind;
  readonly reduced: boolean;
  readonly gel: GelView;
  readonly rail: RailView;
  readonly clock: ClockView;
  readonly metrics: readonly MetricView[];
  /** The pattern block (wide layout, unfolded) of a pattern interval. */
  readonly pattern: PatternBlockView | null;
  readonly cue: CueView;
  readonly next: NextView;
  readonly score: ScoreView;
}
