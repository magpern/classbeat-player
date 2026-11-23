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

/** One jump taken out: the frame, how big, and what marked it. */
export interface Taken { readonly index: number; readonly share: number; readonly cause: string }

/**
 * The series with every one-frame step on a marked frame taken out: each such jump is subtracted from all the frames after it. `marks[i]` is
 * the cause the scheduler's plan or the person's event gives frame i ("" for none). A jump of more than `STEP_SHARE` on a frame no mark names is
 * not taken out: it is returned in `unnamed` (frame indexes) and fails the gate, whatever made it (a beam popping on, a target applied in one
 * frame), except on a frame in which a beam is turning (a sweep): the windows that overlap one are not read, the sweep's count covers its light.
 */
export function withoutSteps(luminance: readonly number[], marks: readonly string[] = [], sweeping: readonly boolean[] = []): { readonly series: number[]; readonly steps: number; readonly unnamed: number[]; readonly taken: Taken[] } {
  const series: number[] = [];
  const unnamed: number[] = [];
  const taken: Taken[] = [];
  let carried = 0;
  luminance.forEach((y, i) => {
    const before = luminance[i - 1];
    if (before !== undefined && larger(y, before) > FLOOR) {
      const share = Math.abs(y - before) / larger(y, before);
      const cause = marks[i] ?? "";
      // A marked frame's jump is the scheduler's, whatever its size; on any other frame a jump over `STEP_SHARE` is reported.
      if (cause !== "") { carried += y - before; if (share > STEP_SHARE) taken.push({ index: i, share, cause }); } else if (share > STEP_SHARE && sweeping[i] !== true) unnamed.push(i);
    }
    series.push(y - carried);
  });
  return { series, steps: taken.length, unnamed, taken };
}

export interface Rate {
  /** The most a region ranged in any window, as a share of the window's highest value. */
  readonly worst: number;
  /** Where that window starts (ms). */
  readonly atMs: number;
  /** How many one-frame steps were taken out first. */
  readonly steps: number;
  /** How many whole windows were read (a window that overlaps a sweep is not, nor one cut short by the start of the series). */
  readonly windows: number;
  /** The times (ms) of one-frame jumps over 2 % on frames no mark names. */
  readonly unnamedAtMs: number[];
  /** Every jump taken out, with its time, its size and its cause. */
  readonly taken: { readonly atMs: number; readonly share: number; readonly cause: string }[];
}

/** A frame at 60 fps is 16.7 ms: a window this much short of its length still ends on its last frame. */
const FRAME_SLACK_MS = 20;

/**
 * The most the series ranges (highest to lowest) in any whole window, as a share of its highest, and where the window starts. The window is
 * 1 s, or one beat when the beat is slower than 60 bpm (`windowMs`, scene.md `--scene-steady-max`).
 */
export function worstRate(timesMs: readonly number[], luminance: readonly number[], sweeping: readonly boolean[] = [], marks: readonly string[] = [], windowMs = 1000): Rate {
  const { series, steps, unnamed, taken } = withoutSteps(luminance, marks, sweeping);
  let [worst, atMs, from] = [0, 0, 0];
  let windows = 0;
  for (let i = 0; i < series.length; i++) {
    while (timesMs[i]! - timesMs[from]! >= windowMs) from++;
    if (timesMs[i]! - timesMs[from]! < windowMs - FRAME_SLACK_MS) continue; // the start of the series: not a whole window
    let [min, max] = [series[i]!, series[i]!];
    if (sweeping.slice(from, i + 1).some(Boolean)) continue;
    for (let j = from; j < i; j++) { min = Math.min(min, series[j]!); max = Math.max(max, series[j]!); }
    windows++;
    if (max > FLOOR && (max - min) / max > worst) [worst, atMs] = [(max - min) / max, timesMs[from]!];
  }
  const at = (i: number) => Math.round(timesMs[i]!);
  return { worst, atMs, steps, windows, unnamedAtMs: unnamed.map(at), taken: taken.map((t) => ({ atMs: at(t.index), share: t.share, cause: t.cause })) };
}
