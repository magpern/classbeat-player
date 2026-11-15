// Quality levels (scene.md "Quality levels"). Pure: no I/O.

import { energyFor } from "./energy.ts";

export type QualityLevel = "High" | "Medium" | "Low";

export interface Quality {
  /** Render scale as a share of the window; the text layer is always full resolution. */
  readonly renderScale: number;
  readonly fixtures: number;
  readonly hazeLayers: 1 | 2;
  readonly wall: boolean;
}

export const QUALITY: Readonly<Record<QualityLevel, Quality>> = {
  High: { renderScale: 0.75, fixtures: 22, hazeLayers: 2, wall: true },
  Medium: { renderScale: 0.5, fixtures: 16, hazeLayers: 1, wall: true },
  Low: { renderScale: 0.35, fixtures: 10, hazeLayers: 1, wall: false },
};

/** Below Low is the plain 2D screen (it is not a scene level). Steps down only, never back up. */
export function stepDown(level: QualityLevel): QualityLevel | "Plain" {
  return level === "High" ? "Medium" : level === "Medium" ? "Low" : "Plain";
}

/** Fixtures actually lit: the zone's count, capped by what the quality level draws. */
export function litFixtures(zone: number, level: QualityLevel): number {
  return Math.min(energyFor(zone).lit, QUALITY[level].fixtures);
}
