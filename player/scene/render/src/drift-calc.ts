// How fast the haze drifts and the wall's wave runs: steady light (scene.md "The flash budget", `--scene-steady-max`). Both are drawn
// from the seconds the loop counts, so a region's light moves at most these rates; #616 slowed them to bring the strict measure of steady
// light (tools/steady-shots.ts) under 2.5 % in every region, 0.5 points inside the 3 % bound. Pure: numbers the shader is built with.

/** The haze's noise field moves this far a second (units of its own coordinates), across and up. */
export const HAZE_DRIFT_X = 0.0125;
export const HAZE_DRIFT_Y = -0.0085;
/** The wall's wave runs this many radians a second. */
export const WALL_WAVE_RATE = 0.3;
