// Energy by zone (scene.md "Energy by zone"). The interval reaches the rig only through this
// table: scalars, never an angle (rule 4). Pure: no I/O.

export type ZoneNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type WallMode = "slow wave" | "wave and beat" | "beat chase" | "beat chase both ways";

export interface Energy {
  /** Linear-light level of the zone colour lighting the haze and the room (brightness, haze). */
  readonly ambientGlow: number;
  /** Fixtures lit, of 22. */
  readonly lit: number;
  /** The motion phase's rate, degrees a second, at most. */
  readonly degPerSecond: number;
  /** Beat-lift depth as a share of every light of the rig (scene.md "The flash budget"). */
  readonly beatLift: number;
  readonly wall: WallMode;
}

export const TOTAL_FIXTURES = 22;
/** No beam, and so no motion phase, turns faster than this (S7). */
export const MAX_DEG_PER_SECOND = 30;
/** The beat lift never exceeds this outside a build (scene.md "The flash budget"): 4.5 % of every light of the rig. */
export const MAX_BEAT_LIFT = 0.045;

export const ZONES: readonly ZoneNumber[] = [1, 2, 3, 4, 5, 6, 7];

export const ENERGY_BY_ZONE: Readonly<Record<ZoneNumber, Energy>> = {
  1: { ambientGlow: 0.045, lit: 8, degPerSecond: 6, beatLift: 0.015, wall: "slow wave" },
  2: { ambientGlow: 0.055, lit: 10, degPerSecond: 8, beatLift: 0.02, wall: "slow wave" },
  3: { ambientGlow: 0.065, lit: 12, degPerSecond: 11, beatLift: 0.025, wall: "wave and beat" },
  4: { ambientGlow: 0.075, lit: 15, degPerSecond: 15, beatLift: 0.03, wall: "beat chase" },
  5: { ambientGlow: 0.085, lit: 17, degPerSecond: 19, beatLift: 0.035, wall: "beat chase" },
  6: { ambientGlow: 0.095, lit: 20, degPerSecond: 24, beatLift: 0.04, wall: "beat chase both ways" },
  7: { ambientGlow: 0.11, lit: 22, degPerSecond: 30, beatLift: 0.045, wall: "beat chase both ways" },
};

export function isZoneNumber(zone: number): zone is ZoneNumber {
  return Number.isInteger(zone) && zone >= 1 && zone <= 7;
}

/** The row of a zone number; a class with fewer zones just uses the rows of its own numbers. */
export function energyFor(zone: number): Energy {
  if (!isZoneNumber(zone)) throw new RangeError(`zone must be an integer from 1 to 7, got ${zone}`);
  return ENERGY_BY_ZONE[zone];
}
