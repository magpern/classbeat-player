// Hold to confirm (docs/design/companion.md, "Guarded: hold to confirm"). Pure: no DOM, no I/O.
// Start, Resume and skip fire only after the thumb has stayed on the key for 0.8 s. The thumb may
// slide up to 16 px outside the key, for a bouncing bike; further cancels. An early lift sends
// nothing and shows "Hold to …" in the key's hint for 2 s.

export const HOLD_MS = 800;
export const SLIDE_PX = 16;
export const SHORT_TAP_HINT_MS = 2000;
/** With reduced motion the bar fills in four steps of 0.2 s. */
export const REDUCED_STEP_MS = 200;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Hold {
  readonly since: number;
  readonly box: Box;
  readonly cancelled: boolean;
  readonly fired: boolean;
}

export const startHold = (at: number, box: Box): Hold => ({ since: at, box, cancelled: false, fired: false });

/** Whether a point is on the key, or within the slide allowance around it. */
export const withinSlide = (b: Box, x: number, y: number): boolean =>
  x >= b.left - SLIDE_PX && x <= b.right + SLIDE_PX && y >= b.top - SLIDE_PX && y <= b.bottom + SLIDE_PX;

/** The thumb moved: the hold is cancelled once it leaves the allowance. */
export const moved = (h: Hold, x: number, y: number): Hold => (h.cancelled || h.fired || withinSlide(h.box, x, y) ? h : { ...h, cancelled: true });

/** The bar's fill, 0 to 1. */
export function progress(h: Hold, at: number, reducedMotion: boolean): number {
  if (h.cancelled) return 0;
  const t = Math.max(0, at - h.since);
  const shown = reducedMotion ? Math.floor(t / REDUCED_STEP_MS) * REDUCED_STEP_MS : t;
  return Math.min(1, shown / HOLD_MS);
}

/** Time passed with the thumb still down: fire once the full 0.8 s is reached. */
export function due(h: Hold, at: number): { hold: Hold; fire: boolean } {
  if (h.cancelled || h.fired || at - h.since < HOLD_MS) return { hold: h, fire: false };
  return { hold: { ...h, fired: true }, fire: true };
}

/** The thumb lifted: a hold that did not fire is a short tap, unless it slid off the key first. */
export function lifted(h: Hold): "fired" | "short" | "cancelled" {
  if (h.fired) return "fired";
  return h.cancelled ? "cancelled" : "short";
}

/** The hint a short tap shows, from the key's action. */
export function shortTapHint(action: "start" | "resume" | "skip"): string {
  return action === "start" ? "Hold to start" : action === "resume" ? "Hold to resume" : "Hold to skip";
}
