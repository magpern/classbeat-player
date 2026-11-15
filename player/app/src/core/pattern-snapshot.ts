// The beat pattern as the room screen is given it: side, count and next side. Pure.
import { patternAt } from "./clock/pattern.ts";
import type { ClockPlan } from "./clock/plan.ts";

export interface PatternSnapshot {
  /** The side the rider is on now. */
  readonly position: "seated" | "standing";
  /** Beat within the current side, 1..n. */
  readonly beat: number;
  /** Beats left on this side, this one included. */
  readonly beatsLeft: number;
  /** The side after this one. */
  readonly nextPosition: "seated" | "standing";
}

/** The pattern at class time `classMs`, or null outside a pattern or whenever the count is not known. */
export function patternSnapshotAt(plan: ClockPlan, classMs: number): PatternSnapshot | null {
  const p = patternAt(plan, classMs);
  if (!p || !p.counted || p.holding || p.beat === null || p.beatsLeft === null || p.nextPosition === null) return null;
  return { position: p.position, beat: p.beat, beatsLeft: p.beatsLeft, nextPosition: p.nextPosition };
}
