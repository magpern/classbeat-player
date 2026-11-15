// The song's look: the pattern the rig is aimed in. It depends on the song's order in the class
// and nothing else, so the same class always gets the same looks (scene.md "What drives what").
// Pure: no I/O, no randomness.

export type Look = "fan" | "cross" | "sweep" | "circle" | "split";

export const LOOKS: readonly Look[] = ["fan", "cross", "sweep", "circle", "split"];

/** The look of the song at `songIndex` (0 = first song). Neighbouring songs never share a look. */
export function lookForSong(songIndex: number): Look {
  if (!Number.isInteger(songIndex) || songIndex < 0) throw new RangeError(`bad song index ${songIndex}`);
  return LOOKS[songIndex % LOOKS.length]!;
}
