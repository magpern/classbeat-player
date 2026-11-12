// Fitting rules that depend only on the text (docs/design/room-2d.md, "Fitting text"). Pure.
// The mock-ups choose by length and the product does the same where a length is enough; what
// only a measurement can answer (a title that fits its line) is measured at the DOM edge.

/** The zone name on the gel: one line, two lines at --t-value, or stepped down to --t-minor. */
export type NameTier = "one" | "two" | "long";

const NAME_ONE_LINE_MAX = 12;
const NAME_TWO_LINE_MAX = 20;
/** A word wider than the gel at --t-value (about 11 characters) forces the step-down. */
const NAME_WORD_MAX = 11;

export function nameTier(name: string): NameTier {
  const longestWord = Math.max(0, ...name.split(/\s+/).map((w) => w.length));
  if (name.length > NAME_TWO_LINE_MAX || longestWord > NAME_WORD_MAX) return "long";
  if (name.length > NAME_ONE_LINE_MAX) return "two";
  return "one";
}

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
  const minPeriod = 1000 / MAX_FLASHES_PER_SECOND + 1;
  let period = 60_000 / bpm;
  while (period < minPeriod) period *= 2;
  return Math.round(period);
}

/** The beat dot needs a tempo and anchors; it never claims to hit a beat it cannot measure. */
export function canShowBeat(bpm: number | null, hasAnchors: boolean): boolean {
  return hasAnchors && bpm !== null && Number.isFinite(bpm) && bpm > 0;
}
