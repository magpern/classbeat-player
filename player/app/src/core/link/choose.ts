// Choosing between repeated recordings (ADR 0001, link state "Ambiguous"). Pure.
// Never a silent guess: when the order does not settle which occurrence plays, the choice is
// reported as ambiguous, it stays ambiguous (also across a coast) until a unique song, the order
// or the instructor settles it, and meanwhile it stays on the occurrence nearest the class time.
import type { Ambiguity, LinkPlan } from "./types.ts";

export interface ChooseInput {
  readonly plan: LinkPlan;
  readonly candidates: readonly number[];
  /** The ambiguity left by earlier readings, kept across coasting and off-the-list stretches. */
  readonly amb: Ambiguity | null;
  /** True when the previous step was Ambiguous too (readings are continuous). */
  readonly continuing: boolean;
  readonly pick: number | null;
  /** The last song known for sure. */
  readonly lastSong: number | null;
  /** The extrapolated position inside the song (rule 8). */
  readonly posMs: number;
  /** Class time now. */
  readonly clockMs: number;
}

export interface Choice {
  readonly index: number;
  readonly ambiguous: boolean;
}

const sameList = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

function nearest(i: ChooseInput): number {
  const where = (k: number): number => Math.min(i.plan.songs[k].endMs, i.plan.songs[k].startMs + i.posMs);
  return i.candidates.reduce((best, k) => (Math.abs(where(k) - i.clockMs) < Math.abs(where(best) - i.clockMs) ? k : best));
}

export function choose(i: ChooseInput): Choice {
  const c = i.candidates;
  if (c.length === 1) return { index: c[0], ambiguous: false };
  if (i.pick !== null && c.includes(i.pick)) return { index: i.pick, ambiguous: false };
  if (i.amb !== null && sameList(i.amb.candidates, c)) {
    return { index: i.continuing ? i.amb.index : nearest(i), ambiguous: true };
  }
  if (i.lastSong !== null) {
    // The order settles it: the song that was playing, or the one after it.
    const order = c.find((k) => k === i.lastSong) ?? c.find((k) => k === (i.lastSong as number) + 1);
    if (order !== undefined) return { index: order, ambiguous: false };
  }
  return { index: nearest(i), ambiguous: true };
}
