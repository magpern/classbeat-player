// What the room screen draws, decided: every string, class and position the DOM needs, so the DOM
// code only places it. Pure types.
import type { NameTier } from "./fit.ts";
import type { ScoreModel } from "./score.ts";

export type RoomKind = "empty" | "before-start" | "running" | "finished";

export interface GelModel {
  /** `zone`: lit; `down`: lights down (paused or not started); `blank`: house lights up. */
  readonly look: "zone" | "down" | "blank";
  readonly zone: number | null;
  readonly label: string;
  readonly numeral: string | null;
  readonly name: string;
  readonly nameTier: NameTier;
  readonly targets: readonly string[];
}

/** `quiet`: grey with a round dot; `alert`: a white plate; `manual`: grey with a square. */
export interface LinkPlate {
  readonly text: string;
  readonly look: "quiet" | "alert" | "manual";
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

export interface MetricModel {
  readonly label: string;
  readonly value: string;
  readonly unit: string | null;
}

export interface NextModel {
  readonly end: boolean;
  readonly zone: number;
  readonly name: string;
  readonly length: string;
  readonly cadence: string | null;
  readonly position: string | null;
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

export interface BeatModel {
  /** Flashes this often; never more than three times a second. */
  readonly periodMs: number;
  /** Where in that period the next beat falls, from the song's own anchors. */
  readonly phaseMs: number;
  /** Changes when the song or tempo does: the dot restarts only then. */
  readonly key: string;
}

export interface RoomModel {
  readonly kind: RoomKind;
  readonly gel: GelModel | null;
  readonly rail: RailModel;
  readonly clock: ClockModel | null;
  readonly metrics: readonly MetricModel[];
  /** The BPM metric has a beat dot beside it. */
  readonly beat: BeatModel | null;
  readonly cue: { readonly text: string; readonly long: boolean } | null;
  readonly next: NextModel | null;
  readonly intro: IntroModel | null;
  readonly score: ScoreModel | null;
  /** Changes when the interval does: the gel's colour crosses and its edge flashes then. */
  readonly intervalKey: string;
  /** The class time the score is drawn for, and whether it advances by itself. */
  readonly classMs: number;
  readonly moving: boolean;
}
