// Zone number to token name (docs/design/system.md, "Shipping the tokens"). Pure.
// Hue only ever means the planned zone (rule 7): nothing else in the product takes these names.

export const ZONE_COUNT = 7;

/** The zones the design system has a gel for, 1 to 7. */
export const ZONES = [1, 2, 3, 4, 5, 6, 7] as const;

export function isZone(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= ZONE_COUNT;
}

/** The CSS custom property that holds the zone's colour, for example `--zone-4`. */
export function zoneToken(zone: number): string {
  return `--zone-${clampZone(zone)}`;
}

/** The class that sets `--zone` for an element standing for this planned zone, for example `z4`. */
export function zoneClass(zone: number): string {
  return `z${clampZone(zone)}`;
}

/** The format validator refuses other zones; clamping keeps the screen drawing if one slips through. */
function clampZone(zone: number): number {
  if (!Number.isFinite(zone)) return 1;
  return Math.min(ZONE_COUNT, Math.max(1, Math.round(zone)));
}
