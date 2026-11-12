// What the class clock needs from a class document: its length, the interval boundaries and the
// song windows (ADR 0001, timing model rule 1; ADR 0003 section 3). Pure: no I/O.
import type { Class } from "../../../../../schema/generated/ts/class.d.ts";

export interface Span {
  readonly startMs: number;
  readonly endMs: number;
}

export interface ClockPlan {
  readonly lengthMs: number;
  readonly intervals: readonly Span[];
  /** Song windows in class time; empty when the class has no songs or its song timing is missing. */
  readonly songs: readonly Span[];
  /** The crossfade the class was designed for (ADR 0001 rule 1). */
  readonly plannedCrossfadeMs: number;
  /** True when the class can only ever run on the manual clock (ADR 0003 section 5). */
  readonly manualOnly: boolean;
}

export function planFrom(doc: Class): ClockPlan {
  const manualOnly = doc.music.source === "none" || doc.music.song_timing === "missing";
  return {
    lengthMs: doc.class.length_ms,
    intervals: doc.intervals.map((iv) => ({ startMs: iv.start_ms, endMs: iv.start_ms + iv.length_ms })),
    // With song timing missing the windows cannot be trusted, so the clock ignores them.
    songs: manualOnly ? [] : doc.songs.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms })),
    plannedCrossfadeMs: doc.music.design_crossfade_ms,
    manualOnly,
  };
}

/**
 * Index of the span holding class time `ms`. Spans are contiguous and start at 0 (the validator
 * guarantees it). At or past the end the last span is returned: the last interval stays on screen
 * (ADR 0001 rule 6). Returns -1 only for an empty list.
 */
export function spanIndexAt(spans: readonly Span[], ms: number): number {
  if (spans.length === 0) return -1;
  let lo = 0;
  let hi = spans.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (spans[mid].startMs <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
