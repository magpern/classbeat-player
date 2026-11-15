// Beam direction (rule 4, S7): a function of the look, the fixture, the motion phase, the phrase
// and the song's moments, and of nothing else. The signature is the guard: there is no interval,
// zone, target, cadence, position, pattern, cue or time in it. Angles are degrees: pan to the
// right, tilt down from the horizontal (negative rises). These are targets: the renderer draws
// them through the turn-rate limiter (turn.ts), at most 30 degrees a second.

import type { Phrase } from "./beat-grid.ts";
import type { Look } from "./looks.ts";
import type { Moments } from "./moments.ts";

export type Layer = "front" | "floor" | "back";
export interface Fixture {
  readonly layer: Layer;
  readonly index: number;
  readonly count: number;
}
export interface Direction {
  readonly pan: number;
  readonly tilt: number;
}

const LAYER_COUNTS: Readonly<Record<Layer, number>> = { front: 8, floor: 6, back: 8 };
const BASE_TILT: Readonly<Record<Layer, number>> = { front: 35, floor: -60, back: 10 };

/** The 22 fixtures: front truss 8, floor uplights 6, back truss 8. */
export const FIXTURES: readonly Fixture[] = (["front", "floor", "back"] as const).flatMap((layer) =>
  Array.from({ length: LAYER_COUNTS[layer] }, (_, index) => ({ layer, index, count: LAYER_COUNTS[layer] })),
);

const rad = (deg: number) => (deg * Math.PI) / 180;
const SWAY = 12;

function aimed(look: Look, s: number, t: number, phase: number): Direction {
  switch (look) {
    case "fan": return { pan: s * 40 + SWAY * Math.sin(rad(phase + t * 120)), tilt: 0 };
    case "cross": return { pan: -s * 40 + SWAY * Math.sin(rad(phase + t * 120)), tilt: 0 };
    case "sweep": return { pan: 30 * Math.sin(rad(phase + t * 180)), tilt: 6 * Math.sin(rad(phase * 2)) };
    case "circle": return { pan: 25 * Math.cos(rad(phase + t * 360)), tilt: 12 * Math.sin(rad(phase + t * 360)) };
    case "split": return { pan: (s < 0 ? -1 : 1) * (15 + 25 * Math.abs(s)) + SWAY * Math.sin(rad(phase + t * 120)), tilt: 0 };
  }
}

export interface BeamInput {
  readonly look: Look;
  readonly fixture: Fixture;
  /** The motion phase, degrees. */
  readonly phaseDeg: number;
  readonly phrase: Phrase;
  readonly moments: Moments;
}

export function beamDirection({ look, fixture, phaseDeg, phrase, moments }: BeamInput): Direction {
  const t = fixture.count > 1 ? fixture.index / (fixture.count - 1) : 0.5;
  const s = 2 * t - 1;
  const base = BASE_TILT[fixture.layer];
  if (moments.gather) return { pan: -s * 30, tilt: base - 15 }; // every beam to one point
  if (moments.fan) return { pan: s * 55, tilt: base }; // fanned wide
  const lead = (t < 0.5 ? 0 : 1) === phrase.leadHalf ? 0 : 60; // the half that leads is 60 degrees ahead
  const d = aimed(look, s, t, phaseDeg + lead);
  return { pan: phrase.mirrored ? -d.pan : d.pan, tilt: base + d.tilt };
}
