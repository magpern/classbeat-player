// S6 (scene.md, "Measurable criteria"): no region larger than 10 % of the screen changes in relative
// luminance by more than 10 % more than 3 times in any second. This counts it as written, on a series of
// frames of one region's relative luminance (linear light, 0 to 1), one value per frame, with its time.
//
// A *change* is a monotone run of the series (the move from one turning point to the next, the zigzag)
// whose size is more than 10 % of the larger of its two ends; a wobble under that does not turn the
// series. Each direction counts, so a flash that rises and falls is two changes. There is no duration
// or abruptness gate and no pairing: a slow ramp over 10 % is a change too. Under `FLOOR` is black. A
// change is placed at the frame where its run first passes 10 %. Pure: no browser, no clock.

/** The size that counts, as a share of the larger end. */
export const CHANGE_THRESHOLD = 0.1;
/** The most changes in any second (S6). */
export const MAX_CHANGES_PER_SECOND = 3;
/** Relative luminance under this is black: noise, not a change. */
export const FLOOR = 0.002;

export interface Change {
  /** When the run first passed the threshold: the frame it is placed on. */
  readonly atMs: number;
  readonly rising: boolean;
  /** The luminance at its two ends. */
  readonly from: number;
  readonly to: number;
}

const differs = (a: number, b: number): boolean => {
  const top = Math.max(a, b);
  return top > FLOOR && Math.abs(b - a) / top > CHANGE_THRESHOLD;
};

/** The changes of one region: the zigzag of the series, each over the threshold, each placed at the frame where it first passes it. */
export function findChanges(timesMs: readonly number[], luminance: readonly number[]): Change[] {
  const changes: Change[] = [];
  const first = luminance.at(0);
  if (first === undefined) return changes;
  let anchor = first;
  let [extreme, passedAt, direction] = [first, 0, 0];
  for (let i = 1; i < luminance.length; i++) {
    const y = luminance[i]!;
    if (direction === 0) {
      if (!differs(anchor, y)) continue;
      [direction, extreme, passedAt] = [y > anchor ? 1 : -1, y, i];
    } else if (y * direction > extreme * direction) {
      extreme = y;
    } else if (differs(extreme, y)) {
      changes.push({ atMs: timesMs[passedAt]!, rising: direction > 0, from: anchor, to: extreme });
      [anchor, direction, extreme, passedAt] = [extreme, -direction, y, i];
    }
  }
  if (direction !== 0 && differs(anchor, extreme)) changes.push({ atMs: timesMs[passedAt]!, rising: direction > 0, from: anchor, to: extreme });
  return changes;
}

/** The most changes that fall within any one second (a window opening at each change). */
export function mostInASecond(changes: readonly Change[]): number {
  return Math.max(0, ...changes.map((s) => changes.filter((o) => o.atMs >= s.atMs && o.atMs < s.atMs + 1000).length));
}
