// Colour (S5, rule 7): the rig shows the current zone's colour, the next zone's colour during
// the 10 s anticipation, and white. The type cannot hold another hue or a measured zone. Pure.

import type { ZoneNumber } from "./energy.ts";
import { isZoneNumber } from "./energy.ts";

export type RigHue = { readonly kind: "zone"; readonly zone: ZoneNumber } | { readonly kind: "white" };

export const WHITE: RigHue = { kind: "white" };
export const ANTICIPATION_MS = 10_000;

export interface RigColours {
  readonly front: RigHue;
  /** Back truss and LED wall only: they turn first, as a wipe from the far side. */
  readonly back: RigHue;
  /** 0 outside the anticipation, then 0..1 over its 10 s (the wipe). */
  readonly wipe: number;
}

function zoneHue(zone: number): RigHue {
  if (!isZoneNumber(zone)) throw new RangeError(`not a planned zone: ${zone}`);
  return { kind: "zone", zone };
}

/**
 * `currentZone` and `nextZone` are the PLANNED zone numbers (never a measured one);
 * `msToChange` is the time to the next interval change, or null at the last interval.
 */
export function rigColours(currentZone: number, nextZone: number | null, msToChange: number | null): RigColours {
  const now = zoneHue(currentZone);
  if (nextZone === null || msToChange === null || msToChange <= 0 || msToChange > ANTICIPATION_MS) {
    return { front: now, back: now, wipe: 0 };
  }
  return { front: now, back: zoneHue(nextZone), wipe: 1 - msToChange / ANTICIPATION_MS };
}
