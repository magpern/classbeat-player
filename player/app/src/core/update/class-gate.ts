// The class gate (ADR 0014, section 3). Pure. While a class is playing or paused mid-class no
// update status is shown, and a check that ends then keeps its result until the class ends.
import type { Status as ClockStatus } from "../clock/clock.ts";
import type { UpdateStatus } from "./status.ts";

export interface ClassGate {
  /** A class is playing or paused mid-class. */
  readonly inClass: boolean;
  /** What the user sees outside a class; null before the first check. */
  readonly shown: UpdateStatus | null;
  /** The newest status that arrived during the class, released when it ends. */
  readonly held: UpdateStatus | null;
}

export const NO_CLASS: ClassGate = { inClass: false, shown: null, held: null };

/** Playing or paused mid-class. A class that is ready to start or has ended is not. No class open is `null`. */
export function midClass(clock: ClockStatus | null): boolean {
  return clock === "running" || clock === "paused";
}

/** A new status from the checker: shown at once outside a class, held during one (the newest wins). */
export function statusArrived(g: ClassGate, status: UpdateStatus): ClassGate {
  return g.inClass ? { ...g, held: status } : { ...g, shown: status, held: null };
}

/** The class started, paused, resumed or ended. Leaving the class releases what was held. */
export function classChanged(g: ClassGate, inClass: boolean): ClassGate {
  if (inClass) return { ...g, inClass: true };
  return { inClass: false, shown: g.held ?? g.shown, held: null };
}

/** What the class list and settings show: nothing during a class. */
export function visible(g: ClassGate): UpdateStatus | null {
  return g.inClass ? null : g.shown;
}
