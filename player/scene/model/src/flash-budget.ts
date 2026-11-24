// The flash budget's beat-like light (scene.md "The flash budget", "Beat-like light, the numbers"): the amplitudes and
// the one shape every beat-like rise and fall shares, and the build's haze step. Every run this light makes alone is at
// most `LIFT_CAP` (5 %) of its larger end in every region, so no run of it passes the 10 % threshold; the scheduler
// (flash-marks.ts, flash-runs.ts) places everything that may. Pure: brightness only, never an angle (rule 4).

/** `--scene-lift-cap`: the largest run beat-like light may make alone in any region, as a share of its larger end. */
export const LIFT_CAP = 0.05;
/** `--scene-steady-max`: the most steady light moves any region in 1 s. */
export const STEADY_MAX = 0.03;
/** Below the Beat level the build's haze rises this share a second (#616: a third of the cap, so the rise and the drift together stay under 2.5 %). */
export const BUILD_HAZE_RISE = 0.01;
/** The beat lift's shape: rise, then fall, back at rest before the next lift (at most 3 a second). */
export const LIFT_RISE_MS = 40;
export const LIFT_FALL_MS = 200;
/** `--scene-tempo-pulse` (Tempo only), within the budget. */
export const TEMPO_PULSE = 0.04;
/** The pattern accent on the first beat of a side, in place of that beat's lift. */
export const ACCENT = 0.05;
/** The lift in a build, beside the haze's step: each rise, step and lift together, at most 5 %. */
export const BUILD_LIFT = 0.02;
export const BUILD_HAZE_STEP = 0.03;
/** `--scene-lens-flash`: the white a lens gains at an interval change, over 0.5 white at rest; 160 ms (`--m-flash`). */
export const LENS_FLASH = 0.25;
export const LENS_WHITE_AT_REST = 0.5;
export const LENS_RISE_MS = 40;
export const LENS_FALL_MS = 120;

/** 0 to 1: a linear rise over `riseMs` and a linear fall over `fallMs`, `ms` after the start (negative: not started). */
export function riseFall(ms: number, riseMs: number, fallMs: number): number {
  if (!(ms >= 0) || ms >= riseMs + fallMs) return 0;
  return ms < riseMs ? ms / riseMs : 1 - (ms - riseMs) / fallMs;
}
export const liftShape = (ms: number): number => riseFall(ms, LIFT_RISE_MS, LIFT_FALL_MS);
/** The lens flash's share, 0 to 1, `ms` after the change frame. */
export const lensShape = (ms: number): number => riseFall(ms, LENS_RISE_MS, LENS_FALL_MS);

/**
 * The haze's gain in a build. At the Beat level it steps up 3 % on each beat, on the lift's 40 ms rise, and stays up
 * (about 1.25 times over 8 beats); below it the haze rises as steady light, 1 % a second (`BUILD_HAZE_RISE`).
 * `elapsedMs` is the time since the build began; `beatMs` the beat (null where the beat is not known).
 */
export function buildHaze(elapsedMs: number, beatMs: number | null): number {
  if (!(elapsedMs >= 0)) return 1;
  if (beatMs === null) return 1 + (BUILD_HAZE_RISE * elapsedMs) / 1000;
  const whole = Math.floor(elapsedMs / beatMs);
  const rise = Math.min(1, (elapsedMs - whole * beatMs) / LIFT_RISE_MS);
  return (1 + BUILD_HAZE_STEP) ** (whole + rise);
}
