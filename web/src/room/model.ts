// What the room screen draws, decided: every string, class and position the DOM needs, so the DOM
// code only places it. Pure types.
import type { ScoreModel } from "./score.ts";

export type RoomKind = "empty" | "before-start" | "running" | "finished";

export interface GelModel {
  /** `zone`: lit; `down`: lights down (paused or not started); `blank`: house lights up. */
  readonly look: "zone" | "down" | "blank";
  readonly zone: number | null;
  readonly label: string;
  readonly numeral: string | null;
  readonly name: string;
  readonly targets: readonly string[];
}

/** `quiet`: grey with a round dot; `alert`: a white plate; `manual`: grey with a square. */
export interface LinkPlate {
  readonly text: string;
  readonly look: "quiet" | "alert" | "manual";
  /** White instead of grey: the clock was just handed over to the instructor (news, not a fault). */
  readonly news?: true;
}

export interface RailModel {
  readonly left: string | null;
  readonly done: string | null;
  readonly segment: string | null;
  readonly link: LinkPlate | null;
}

export type ClockLine =
  | { readonly kind: "bars"; readonly count: number; readonly tail: string }
  | { readonly kind: "song"; readonly time: string }
  | { readonly kind: "text"; readonly text: string };

export interface ClockModel {
  readonly label: string;
  /** The outlined "FTP test" tag before the label. */
  readonly ftpTag: boolean;
  /** The "Paused" plate, in place of the label. */
  readonly pill: boolean;
  readonly count: string;
  /** The interval's format is MM:SS (or 99+): the countdown is sized for it. */
  readonly wide: boolean;
  /** Dimmed with a dashed rule: the clock only guesses. */
  readonly estimated: boolean;
  readonly line: ClockLine | null;
}

/**
 * The Position metric in a pattern interval (room-2d.md, "A position pattern"): the side with the
 * beats left on it, the side with "Starts on the next bar", or a note when no count can be given.
 */
export type PatternValue =
  | { readonly kind: "count"; readonly side: "UP" | "DOWN"; readonly count: string }
  | { readonly kind: "soon"; readonly side: "UP" | "DOWN"; readonly text: string }
  | { readonly kind: "note"; readonly text: string };

export interface MetricModel {
  readonly label: string;
  readonly value: string;
  readonly unit: string | null;
  /** Set on the Position metric of a pattern interval; `value` is then its plain text. */
  readonly pattern?: PatternValue;
}

export interface NextModel {
  readonly end: boolean;
  readonly zone: number;
  readonly name: string;
  readonly length: string;
  readonly cadence: string | null;
  /** "Seated", "Standing", or the pattern in words ("4 up, 4 down"). */
  readonly position: string | null;
  /** The next interval's cue, as written: the row's second line; none when it has none. */
  readonly cue: string | null;
}

export interface FactModel {
  readonly label: string;
  readonly value: string;
}

export interface ZoneRow {
  readonly zone: number;
  readonly time: string;
  readonly name: string;
}

export interface IntroModel {
  readonly title: string;
  readonly facts: readonly FactModel[];
  readonly zonesTitle: string;
  readonly zones: readonly ZoneRow[];
}

/**
 * A pattern's count running (room-2d.md, "Every change is a step"): the beat in force and the beats left on
 * this side. The count steps on its ticks, so the screen needs the beat to place the next switch.
 */
export interface CountModel {
  readonly beatMs: number;
  readonly beatsLeft: number;
}

export interface RoomModel {
  readonly kind: RoomKind;
  readonly gel: GelModel | null;
  readonly rail: RailModel;
  readonly clock: ClockModel | null;
  readonly metrics: readonly MetricModel[];
  /** Set while a pattern's count runs: the countdown, bars line and score show on its ticks. */
  readonly count: CountModel | null;
  readonly cue: { readonly text: string; readonly long: boolean } | null;
  readonly next: NextModel | null;
  readonly intro: IntroModel | null;
  readonly score: ScoreModel | null;
  /** Changes when the interval does: the change frame (the gel's colour is cut, never mixed). */
  readonly intervalKey: string;
  /** The class time the score is drawn for, and whether the clock runs on by itself. */
  readonly classMs: number;
  readonly moving: boolean;
  /** While the clock runs: the time to the next change frame, the interval's end (merged intervals counted); else null. */
  readonly changeInMs: number | null;
}
