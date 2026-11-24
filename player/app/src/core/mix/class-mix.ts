// What the mix code reads from a class's `music.swedebeat_mix` (class format 1.3): the id, the mix
// length and the offset, and nothing else. The reader keeps unknown fields (for example a link);
// they are never read, copied or passed on, so a class cannot steer the source with one. Pure.

/** A provider's mix id as the format allows it: 1 to 64 characters of `[A-Za-z0-9_-]` (the schema's `swedebeatMix.id`; no dot). */
export const MIX_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface ClassMix {
  readonly id: string;
  readonly lengthMs: number;
  readonly offsetMs: number;
}

/** The mix a class names, or null when `music` names none or the three fields are not as the format says. */
export function classMixOf(music: unknown): ClassMix | null {
  if (music === null || typeof music !== "object") return null;
  const m = (music as { swedebeat_mix?: unknown }).swedebeat_mix;
  if (m === null || typeof m !== "object") return null;
  const { id, length_ms, offset_ms = 0 } = m as Record<string, unknown>;
  if (typeof id !== "string" || !MIX_ID.test(id)) return null;
  if (!Number.isInteger(length_ms) || (length_ms as number) < 1) return null;
  if (!Number.isInteger(offset_ms) || (offset_ms as number) < 0) return null;
  return { id, lengthMs: length_ms as number, offsetMs: offset_ms as number };
}
