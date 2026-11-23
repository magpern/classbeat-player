// `--scene-steady-max` (scene.md "The flash budget"): steady light moves no region more than 3 % of its luminance in any 1 s while
// the beat runs. This measures it on a series of frames of one region's relative luminance (linear light, 0 to 1) of the scene
// drawn with steady light alone (src/steady-calc.ts), one value per frame, with its time. A step in the series (a scheduled
// change the scene draws in one frame: the energy in an interval's change frame, a quality step) is not steady light: it is the
// scheduler's, counted by S6, so its one-frame jump is taken out of the series before the rate is read. Pure: no browser, no clock.

/** The most steady light moves a region, as a share of the larger end, in any 1 s (`--scene-steady-max`). */
export const STEADY_MAX = 0.03;
/** Relative luminance under this is black: nothing to move. */
export const FLOOR = 0.002;
/** A one-frame jump over this share of the larger end is a scheduled step, not steady light (3 % a second is 0.05 % a frame). */
export const STEP_SHARE = 0.02;

const larger = (a: number, b: number): number => Math.max(a, b);

/** The series with every one-frame step taken out: each step's jump is subtracted from all the frames after it. */
export function withoutSteps(luminance: readonly number[]): { readonly series: number[]; readonly steps: number } {
  const series: number[] = [];
  let carried = 0;
  let steps = 0;
  luminance.forEach((y, i) => {
    const before = luminance[i - 1];
    if (before !== undefined && larger(y, before) > FLOOR && Math.abs(y - before) / larger(y, before) > STEP_SHARE) {
      carried += y - before;
      steps++;
    }
    series.push(y - carried);
  });
  return { series, steps };
}

export interface Rate {
  /** The most a region ranged in any window of 1 s, as a share of the window's highest value. */
  readonly worst: number;
  /** Where that window starts (ms). */
  readonly atMs: number;
  /** How many one-frame steps were taken out first. */
  readonly steps: number;
  /** How many 1 s windows were read (a window that overlaps a sweep is not). */
  readonly windows: number;
}

/** The most the series ranges (highest to lowest) in any window of 1 s, as a share of its highest, and where the window starts. */
export function worstRate(timesMs: readonly number[], luminance: readonly number[], sweeping: readonly boolean[] = []): Rate {
  const { series, steps } = withoutSteps(luminance);
  let [worst, atMs, from, read] = [0, 0, 0, 0];
  let windows = 0;
  for (let i = 0; i < series.length; i++) {
    while (timesMs[i]! - timesMs[from]! >= 1000) from++;
    let [min, max] = [series[i]!, series[i]!];
    read = 0;
    for (let j = from; j <= i; j++) if (sweeping[j] === true) { read = -1; break; }
    if (read < 0) continue;
    for (let j = from; j < i; j++) { min = Math.min(min, series[j]!); max = Math.max(max, series[j]!); }
    windows++;
    if (max > FLOOR && (max - min) / max > worst) [worst, atMs] = [(max - min) / max, timesMs[from]!];
  }
  return { worst, atMs, steps, windows };
}
