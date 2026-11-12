// The shape of what the player's shell sends a screen: the open class, the clock view and the
// music link view. It mirrors the fields of `Snapshot` in player/app/src/core/snapshot.ts that
// the room screen reads (this lane never imports from player/ at run time; a type-only test,
// test/unit/snapshot-compat.test.ts, fails the build when the two drift apart). Pure types.
import type { Class } from "../../../schema/generated/ts/class.d.ts";

export type { Class };

export type ClockStatus = "ready" | "running" | "paused" | "ended";

export type LinkStateName = "Locked" | "Paused" | "Coasting" | "Off the list" | "Ambiguous" | "Manual";

export interface ClockInput {
  readonly status: ClockStatus;
  readonly classMs: number;
  readonly lengthMs: number;
  readonly classRemainingMs: number;
  readonly intervalIndex: number;
  readonly intervalRemainingMs: number;
  readonly nextIntervalIndex: number | null;
  readonly songIndex: number | null;
}

export interface LinkInput {
  readonly mode: "following" | "manual";
  readonly state: LinkStateName;
  /** The clock only guesses (Coasting, Off the list). */
  readonly guessing: boolean;
  readonly songIndex: number | null;
  /** The clock holds at a song window's end; the last interval stays on screen. */
  readonly held: boolean;
  readonly holdRemainingMs: number | null;
  /** Ambiguous: the song indexes the same recording could be. */
  readonly candidates: readonly number[];
  /** Time left in the class follows the measurement. */
  readonly classRemainingMs: number;
}

/** What the room screen is given: a recorded or live snapshot. */
export interface RoomInput {
  readonly doc: Class | null;
  readonly view: ClockInput | null;
  readonly link: LinkInput | null;
}
