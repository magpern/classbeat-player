// The room screen's link line for a mix class (docs/design/swedebeat.md, "Room screen"). Pure: the
// state of the mix playback and the clock in, one fixed line of words and a shape out. The words
// are the fixed lists of core/mix/mode-policy.ts; nothing from a class, a source or a path.
import { REASON_WORDS, SHORT_REASON_WORDS } from "./mode-policy.ts";
import type { FallbackReason } from "./mode-policy.ts";

/** `dot`: white filled circle; `circle`: grey hollow circle; `square`: grey square; `news`: white square. */
export type MixShape = "dot" | "circle" | "square" | "news";

export interface MixLine {
  readonly text: string;
  readonly shape: MixShape;
}

/** What the shell knows of the mix of the open class. */
export type MixPlayState =
  /** Before the start: the mix is complete and checked. */
  | { readonly kind: "ready" }
  /** Before the start: downloading, `percent` 0 to 100 (Start works: it plays while it downloads). */
  | { readonly kind: "downloading"; readonly percent: number }
  /** The class runs on the mix. */
  | { readonly kind: "playing" }
  /** The manual clock; `since` is when a fall back during the class happened (null: decided before the start). */
  | { readonly kind: "manual"; readonly reason: FallbackReason; readonly since: number | null };

/** The short reason shows this long after a fall back during the class, then "Manual clock". */
export const FELL_BACK_SHOW_MS = 30_000;

/** The line, or null when the class is not a mix class. `started`: the clock has left "ready". */
export function mixLineOf(s: MixPlayState | null, started: boolean, now: number): MixLine | null {
  if (s === null) return null;
  switch (s.kind) {
    case "ready":
      return started ? { text: "Playing the mix", shape: "dot" } : { text: "Mix ready", shape: "dot" };
    case "downloading":
      return started ? { text: "Playing the mix", shape: "dot" } : { text: `Downloading the mix ${wholePercent(s.percent)}%`, shape: "circle" };
    case "playing":
      return { text: "Playing the mix", shape: "dot" };
    case "manual": {
      if (!started) return { text: `Press Start · ${REASON_WORDS[s.reason]}`, shape: "square" };
      const short = SHORT_REASON_WORDS[s.reason];
      if (s.since !== null && short !== undefined && now - s.since < FELL_BACK_SHOW_MS) return { text: short, shape: "news" };
      return { text: "Manual clock", shape: "square" };
    }
  }
}

const wholePercent = (p: number): number => (Number.isFinite(p) ? Math.min(100, Math.max(0, Math.floor(p))) : 0);
