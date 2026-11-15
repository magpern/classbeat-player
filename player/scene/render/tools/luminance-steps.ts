// S6 (scene.md, "Measurable criteria"): no region larger than 10 % of the screen changes in relative
// luminance by more than 10 % more than 3 times in any second. This counts it, on a series of frames of
// one region's relative luminance (linear light, 0 to 1), one value per frame, with the frame's time.
//
// A *swing* is the move from one turning point of the luminance to the next (the zigzag of the series),
// over the threshold; a wobble under it does not turn the series. A swing is *abrupt* if it goes from 10 %
// to 90 % of its way in 300 ms or less: a jump on a beat, the burst's onset and its 250 ms fall, the song
// change's dim and its end, a lens flash. A slow swing (the 700 ms colour cross, a beam fan opening, the
// lift's slow decay, the haze's drift) is a change of look, not a flash, and is not counted.
// A *step* is what S6 counts: an abrupt swing, except that two opposite abrupt swings in a row within
// 700 ms that end where the first began are one step, a flash that came and went (a beat's lift, a burst
// on a lit room, a dim for one beat and its end). Abrupt swings that do not return (the combined song and
// interval change: the burst's onset on the room that was lit, its decay to the dimmed room, the end of
// the dim) are each a step. Under `FLOOR` is black. A swing is placed at the time it ends.
//
// Two ways to size a swing, both run by the browser measurement: "relative", more than 10 % of the larger
// of its two ends (strict: in a dim region a small change counts), and "absolute", a change of more than
// 0.1 in relative luminance, WCAG 2.3.1's "10 % of the maximum relative luminance" (the maximum is 1).
// Pure: no browser, no clock.

/** The swing that counts: a share of the larger end ("relative") or a change in relative luminance ("absolute"). */
export const STEP_THRESHOLD = 0.1;
/** The most steps in any second (S6). */
export const MAX_STEPS_PER_SECOND = 3;
/** Relative luminance under this is black: noise, not a step. */
export const FLOOR = 0.002;
/** A swing and the one that undoes it are one flash if they are this close. */
export const FLASH_MS = 700;
/** A swing that takes longer than this from 10 % to 90 % of its way is a change of look, not a flash. */
export const ABRUPT_MS = 300;

export type Measure = "relative" | "absolute";

export interface Step {
  /** When the swing ended. */
  readonly atMs: number;
  readonly rising: boolean;
  /** The luminance at its two ends. */
  readonly from: number;
  readonly to: number;
  /** A flash and its return: the step counts once. */
  readonly returns: boolean;
}

const differs = (a: number, b: number, threshold: number, measure: Measure): boolean => {
  const top = Math.max(a, b);
  return top > FLOOR && (measure === "absolute" ? Math.abs(b - a) > threshold : Math.abs(b - a) / top > threshold);
};

interface Swing { readonly atMs: number; readonly rising: boolean; readonly from: number; readonly to: number; readonly riseMs: number }

/** The time a swing takes from 10 % to 90 % of its way, over the samples `from` to `to` (indices). */
function riseTime(timesMs: readonly number[], luminance: readonly number[], first: number, last: number): number {
  const [a, b] = [luminance[first]!, luminance[last]!];
  const share = (i: number) => (b === a ? 1 : (luminance[i]! - a) / (b - a));
  let [t10, t90] = [timesMs[last]!, timesMs[last]!];
  for (let i = first; i <= last; i++) if (share(i) >= 0.1) { t10 = timesMs[i]!; break; }
  for (let i = first; i <= last; i++) if (share(i) >= 0.9) { t90 = timesMs[i]!; break; }
  return t90 - t10;
}

/** The swings of one region: the zigzag of the series, each over the threshold. */
function swingsOf(timesMs: readonly number[], luminance: readonly number[], threshold: number, measure: Measure): Swing[] {
  const swings: Swing[] = [];
  const first = luminance.at(0);
  if (first === undefined) return swings;
  let [anchor, anchorAt] = [first, 0];
  let [extreme, extremeAt, direction] = [first, 0, 0];
  const push = () => swings.push({ atMs: timesMs[extremeAt]!, rising: direction > 0, from: anchor, to: extreme, riseMs: riseTime(timesMs, luminance, anchorAt, extremeAt) });
  for (let i = 1; i < luminance.length; i++) {
    const y = luminance[i]!;
    if (direction === 0) {
      if (!differs(anchor, y, threshold, measure)) continue;
      [direction, extreme, extremeAt] = [y > anchor ? 1 : -1, y, i];
    } else if (y * direction > extreme * direction) {
      [extreme, extremeAt] = [y, i];
    } else if (differs(extreme, y, threshold, measure)) {
      push();
      [anchor, anchorAt, direction, extreme, extremeAt] = [extreme, extremeAt, -direction, y, i];
    }
  }
  if (direction !== 0 && differs(anchor, extreme, threshold, measure)) push();
  return swings;
}

/** The steps of one region: its abrupt swings, a swing and its return counted once. */
export function findSteps(timesMs: readonly number[], luminance: readonly number[], measure: Measure = "relative", threshold = STEP_THRESHOLD): Step[] {
  const swings = swingsOf(timesMs, luminance, threshold, measure).filter((s) => s.riseMs <= ABRUPT_MS);
  const steps: Step[] = [];
  for (let k = 0; k < swings.length; k++) {
    const s = swings[k]!;
    const next = swings[k + 1];
    const returns = next !== undefined && next.rising !== s.rising && next.atMs - s.atMs <= FLASH_MS && !differs(s.from, next.to, threshold, measure);
    steps.push({ atMs: s.atMs, rising: s.rising, from: s.from, to: s.to, returns });
    if (returns) k++;
  }
  return steps;
}

/** The most steps that end within any one second (a window opening at each step). */
export function mostInASecond(steps: readonly Step[]): number {
  return Math.max(0, ...steps.map((s) => steps.filter((o) => o.atMs >= s.atMs && o.atMs < s.atMs + 1000).length));
}
