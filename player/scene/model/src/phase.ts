// The motion phase: the one clock that moves the beams. Its rate is the zone's row of the energy
// table and nothing else (S7), so it takes a zone number and no interval. Pure.

import { MAX_DEG_PER_SECOND, energyFor } from "./energy.ts";

/** Degrees a second the phase advances in `zone`, at most 30. */
export function phaseRate(zone: number): number {
  return Math.min(MAX_DEG_PER_SECOND, energyFor(zone).degPerSecond);
}

/**
 * The phase after `dtSeconds` in `zone`, wrapped to [0, 360). A negative step is ignored.
 * `scale` (0 to 1, 1 by default) slows the whole rig: off the list and before the start the
 * movement is halved (scene.md "States"); it can never speed the phase up past the zone's row.
 */
export function advancePhase(phaseDeg: number, dtSeconds: number, zone: number, scale = 1): number {
  const slow = Number.isFinite(scale) ? Math.min(1, Math.max(0, scale)) : 1;
  const next = phaseDeg + phaseRate(zone) * slow * Math.max(0, dtSeconds);
  return ((next % 360) + 360) % 360;
}
