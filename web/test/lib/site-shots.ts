// The website's screenshot shots and their names, shared by site-checks.test.ts (which takes them),
// site-measure.ts (which measures one) and check-site-shards.ts (which checks that the parts of
// spec-shards.txt take each exactly once): every state at the phone and desktop sizes, the main
// states also at the tablet size and at 320 px, and every state at 200 % text (S9).
import type { State } from "./site-states.ts";

export interface SiteShot {
  readonly state: State;
  readonly width: number;
  /** The browser's text size: 1 is 100 %, 2 is 200 % (S9). */
  readonly zoom: 1 | 2;
  /** Measure the ink of every text (S1, S2 and overlaps); reflow-only shots skip it. */
  readonly ink: boolean;
}

export const siteShotName = (s: SiteShot): string => `site-${s.state.name}-${s.width}${s.zoom === 2 ? "-text200" : ""}`;

/** Every shot of `states`, in the order site-checks.test.ts takes them. */
export const siteShots = (states: readonly State[]): SiteShot[] =>
  states.flatMap((state) => [
    ...[390, 1280, ...(state.main ? [820, 320] : [])].map((width) => ({ state, width, zoom: 1 as const, ink: true })),
    // 200 % text: reflow, sizes, layout and cut text at the phone and the desktop size.
    ...[390, 1280].map((width) => ({ state, width, zoom: 2 as const, ink: false })),
  ]);
