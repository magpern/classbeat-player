// Fitting rules that depend only on the text (docs/design/room-2d.md, "Fitting text"). Pure.
// What only a measurement can answer (a zone name, a title or a cue that fits its box: widths
// depend on the glyphs) is measured at the DOM edge, never counted in characters.

/** A cue over 60 characters is set at --t-text-min. */
export const CUE_LONG_OVER = 60;

export function cueIsLong(cue: string): boolean {
  return cue.length > CUE_LONG_OVER;
}

/** Three targets (%FTP, RPE, %HRmax) change how a two-line name fits the narrow gel. */
export function hasThreeTargets(targets: readonly string[]): boolean {
  return targets.length >= 3;
}

/** Nothing flashes more than three times a second (system.md, Motion). */
export const MAX_FLASHES_PER_SECOND = 3;

/**
 * How often the beat dot flashes: on every beat, or on every second (third ...) beat when the
 * tempo would make it flash more than three times a second.
 */
export function beatPeriodMs(bpm: number): number {
  const minPeriod = 1000 / MAX_FLASHES_PER_SECOND;
  let period = 60_000 / bpm;
  while (period < minPeriod - 1e-9) period *= 2;
  // The exact period, so the dot does not drift off the beat: every beat up to 180 BPM, every
  // second (fourth ...) beat above it.
  return period;
}

/** The beat dot needs a tempo and anchors; it never claims to hit a beat it cannot measure. */
export function canShowBeat(bpm: number | null, hasAnchors: boolean): boolean {
  return hasAnchors && bpm !== null && Number.isFinite(bpm) && bpm > 0;
}
