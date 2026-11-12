// Text for the presenter. Pure.
import type { Interval, ZoneDef } from "../../../../schema/generated/ts/class.d.ts";

/** m:ss, or h:mm:ss from one hour; whole seconds, rounded down. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The zone as a number and a name (never a colour alone). */
export function zoneText(zone: number, scale: readonly ZoneDef[]): string {
  const def = scale.find((z) => z.zone === zone);
  return def ? `Zone ${zone} ${def.name}` : `Zone ${zone}`;
}

/** Cadence, position and incline as text targets. */
export function targetText(iv: Interval): string {
  const parts: string[] = [];
  if (iv.cadence === "beat") parts.push("on the beat");
  else if (iv.cadence) parts.push(`${iv.cadence.from}-${iv.cadence.to} rpm`);
  if (iv.position) parts.push(iv.position);
  if (iv.incline) parts.push(`incline ${iv.incline}`);
  if (iv.test) parts.push(`FTP test ${iv.test.minutes} min`);
  return parts.join(", ");
}
