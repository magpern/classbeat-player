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
