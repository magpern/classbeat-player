// The link line of a mix class (docs/design/swedebeat.md, "Room screen"): the player decides the
// words and the shape (player/app/src/core/mix/mix-line.ts) and the frame carries them as `mix`.
// The screen draws only words from this fixed list, so nothing from a class, a source or a path
// reaches the rail; anything else is not drawn. Shapes: a white dot for the music, a hollow grey
// circle while it downloads, a grey square for the manual clock, a white square for news. Pure.
import type { MixInput } from "./input.ts";
import type { LinkPlate } from "./model.ts";

/** The long reasons, after "Press Start · " before the start (the player's REASON_WORDS). */
export const MIX_REASONS: readonly string[] = [
  "Swedebeat playback is off",
  "Swedebeat is not connected",
  "The mix is still downloading",
  "The mix could not be checked",
  "Swedebeat cannot be connected here",
  "This account cannot play this mix",
];

/** The short reasons for the 30 s after a fall back during the class (the player's SHORT_REASON_WORDS). */
export const MIX_SHORT_REASONS: readonly string[] = ["Mix still downloading", "Mix not checked", "Signed out of Swedebeat"];

const DOWNLOADING = /^Downloading the mix (?:100|[1-9]?\d)%$/;

/** True when the line's words and shape are one of the spec's fixed pairs. */
export function mixWordsAllowed(m: MixInput): boolean {
  switch (m.shape) {
    case "dot":
      return m.text === "Mix ready" || m.text === "Playing the mix";
    case "circle":
      return DOWNLOADING.test(m.text);
    case "square":
      return m.text === "Manual clock" || MIX_REASONS.some((r) => m.text === `Press Start · ${r}`);
    case "news":
      return MIX_SHORT_REASONS.includes(m.text);
    default:
      return false;
  }
}

/** The rail's plate for the line, or null when the line is not one of the fixed pairs. */
export function mixPlate(m: MixInput | null | undefined): LinkPlate | null {
  if (!m || typeof m.text !== "string" || !mixWordsAllowed(m)) return null;
  switch (m.shape) {
    case "dot":
      return { text: m.text, look: "ready" };
    case "circle":
      return { text: m.text, look: "work" };
    case "square":
      return { text: m.text, look: "manual" };
    case "news":
      return { text: m.text, look: "manual", news: true };
  }
}
