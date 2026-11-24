// Field walking shared by the parsers: the optional fields of a notification, in order, with the
// offset of each. `end` is where the last field stops; null when the buffer is too short for what
// the flags promise (never throws).
export type Field = readonly [key: string, present: boolean, size: number];

export interface Walked {
  readonly at: Record<string, number>;
  readonly end: number;
}

export function walk(dv: DataView, start: number, fields: readonly Field[]): Walked | null {
  const at: Record<string, number> = {};
  let pos = start;
  for (const [key, present, size] of fields) {
    if (!present) continue;
    at[key] = pos;
    pos += size;
  }
  return pos <= dv.byteLength ? { at, end: pos } : null;
}

export const bit = (flags: number, n: number): boolean => ((flags >> n) & 1) === 1;
