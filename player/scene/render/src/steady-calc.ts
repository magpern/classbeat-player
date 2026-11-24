// Steady light on its own (scene.md "The flash budget", `--scene-steady-max`): the draw with everything the scheduler places
// taken out (the beat lift, the lens flash, the burst, the energy ramp, the master level's dims, the build's haze steps and the
// wall's beat chase), so what is left is what moves without a mark: the looks, the beams' turns, the haze's drift, the wall's
// slow wave. The S6 gate renders this to measure the rate steady light moves each region (tools/steady-rate.ts). Pure; the
// product never draws it.

import type { Draw } from "./loop.ts";

export function steadyOnly(draw: Draw): Draw {
  return {
    ...draw,
    lift: 0,
    lens: 0,
    burst: 0,
    energyRamp: 0,
    ahead: null,
    beamLevel: 1, // the pattern's side step is beat-like light
    master: 1,
    chaseStep: null,
    // Below the Beat level the build's haze rises steadily; at it, it steps with the beat, which is beat-like light.
    hazeGain: draw.frame.level === "Beat" ? 1 : draw.hazeGain,
  };
}
