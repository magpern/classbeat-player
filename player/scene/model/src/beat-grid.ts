// The song's beat grid from its anchors (`at_ms`, `bpm`), and the phrase (every 8 bars).
// Nothing beat-like is guessed: without anchors there is no grid. A bar is four beats. Pure.

export interface BeatAnchor {
  readonly at_ms: number;
  readonly bpm: number;
}

export const BEATS_PER_BAR = 4;
export const BARS_PER_PHRASE = 8;

/** Beats since the first anchor at song position `posMs` (negative before it); null with no anchors. */
export function beatsAt(anchors: readonly BeatAnchor[] | undefined, posMs: number): number | null {
  if (!anchors || anchors.length === 0) return null;
  let beats = 0;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!;
    const next = anchors[i + 1];
    if (next === undefined || posMs < next.at_ms) return beats + ((posMs - a.at_ms) * a.bpm) / 60_000;
    beats += ((next.at_ms - a.at_ms) * a.bpm) / 60_000;
  }
  return beats;
}

export interface Phrase {
  readonly index: number;
  /** Odd phrases are mirrored (left and right swapped, chase reversed). */
  readonly mirrored: boolean;
  /** Which half of the fixtures leads: 0 or 1. */
  readonly leadHalf: 0 | 1;
}

export const FIRST_PHRASE: Phrase = { index: 0, mirrored: false, leadHalf: 0 };

export function phraseOfIndex(index: number): Phrase {
  const i = Math.max(0, Math.trunc(index));
  return { index: i, mirrored: i % 2 === 1, leadHalf: Math.floor(i / 2) % 2 === 0 ? 0 : 1 };
}

/** The phrase at a song position; the first phrase when the grid is not known. */
export function phraseAt(anchors: readonly BeatAnchor[] | undefined, posMs: number): Phrase {
  const beats = beatsAt(anchors, posMs);
  if (beats === null) return FIRST_PHRASE;
  return phraseOfIndex(Math.floor(beats / (BEATS_PER_BAR * BARS_PER_PHRASE)));
}
