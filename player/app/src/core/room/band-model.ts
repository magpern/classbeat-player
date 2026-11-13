// When the room screen's control band shows and hides (room-2d.md, "When it shows and when it
// hides"). Pure: the page passes each input with the time, and asks when to look again.
//
// - It shows on a pointer move of at least MOVE_PX, a click or tap, Tab and the End key.
// - It hides HIDE_AFTER_MS after the last input of any kind; only keyboard focus reached by Tab
//   and the End question hold it. A pointer resting over it or a press with the pointer does not.
// - From the first frame of the fade-out it counts as hidden: it takes no presses, and a click or
//   tap then only shows it again. A click or tap while hidden presses nothing.
// - With one display it does not hide before the start, nor on "Class Complete" (`pinned`).

export const HIDE_AFTER_MS = 3000;
/** `--m-state`; 0 with reduced motion. */
export const FADE_MS = 300;
/** A smaller move is a nudged table, not a hand on the mouse. */
export const MOVE_PX = 6;
/** The End question answers "Keep going" by itself after this long. */
export const ASK_TIMEOUT_MS = 8000;

export type Phase = "hidden" | "shown" | "fading";

export interface BandState {
  readonly phase: Phase;
  readonly lastInputAt: number;
  readonly fadeEndsAt: number | null;
  /** Keyboard focus inside the band, reached by Tab or Shift+Tab. */
  readonly tabFocus: boolean;
  /** The End question is open. */
  readonly asking: boolean;
  /** Where the pointer was when it last counted as a move. */
  readonly anchor: { readonly x: number; readonly y: number } | null;
}

export interface BandContext {
  /** One display, before the start or on "Class Complete": the band stays in sight. */
  readonly pinned: boolean;
  readonly fadeMs: number;
}

export const HIDDEN: BandState = { phase: "hidden", lastInputAt: 0, fadeEndsAt: null, tabFocus: false, asking: false, anchor: null };

/** Pinned with one display before the start ("ready") and on "Class Complete" ("ended"); never with a second display. */
export const isPinned = (alone: boolean, status: string | null): boolean => alone && (status === "ready" || status === "ended");

const held = (s: BandState): boolean => s.tabFocus || s.asking;
const show = (s: BandState, now: number): BandState => ({ ...s, phase: "shown", lastInputAt: now, fadeEndsAt: null });

/** The band takes presses only while fully shown (not while fading out). */
export const takesPresses = (s: BandState, ctx: BandContext): boolean => ctx.pinned || s.phase === "shown";

/** A pointer move: shows the band (or restarts the 3 s) when it is at least MOVE_PX from the last one that counted. */
export function pointerMove(s: BandState, x: number, y: number, now: number): BandState {
  if (s.anchor === null) return { ...s, anchor: { x, y } };
  if (Math.hypot(x - s.anchor.x, y - s.anchor.y) < MOVE_PX) return s;
  return { ...show(s, now), anchor: { x, y } };
}

/**
 * A click or tap anywhere. `pressed` says whether a button under it may act: only when the band
 * was already shown. Either way the band shows (or stays) for another 3 s, and a pointer press
 * drops the keyboard focus, so it never holds the band.
 */
export function press(s: BandState, now: number, ctx: BandContext): { state: BandState; pressed: boolean } {
  return { state: { ...show(s, now), tabFocus: false }, pressed: takesPresses(s, ctx) };
}

/** A key press that does something else (Space, the arrows, F): restarts the 3 s if shown, never shows it. */
export const keyPress = (s: BandState, now: number): BandState => (s.phase === "shown" ? { ...s, lastInputAt: now } : s);

/** Tab, Shift+Tab and the End key show the band. */
export const reveal = (s: BandState, now: number): BandState => show(s, now);

export const tabFocus = (s: BandState, on: boolean, now: number): BandState => ({ ...s, tabFocus: on, lastInputAt: now });

/** The End question opens (it shows the band) or closes (the 3 s start again). */
export const asking = (s: BandState, on: boolean, now: number): BandState => ({ ...show(s, now), asking: on });

/** Esc with no question open: hides the band at once and drops the focus (unless pinned). */
export function escape(s: BandState, now: number, ctx: BandContext): BandState {
  const dropped = { ...s, tabFocus: false };
  if (ctx.pinned || s.phase !== "shown") return dropped;
  return ctx.fadeMs > 0 ? { ...dropped, phase: "fading", fadeEndsAt: now + ctx.fadeMs } : { ...dropped, phase: "hidden", fadeEndsAt: null };
}

/** Time passes: the 3 s run out (fade-out begins), the fade ends (hidden), or pinning shows it. */
export function tick(s: BandState, now: number, ctx: BandContext): BandState {
  if (ctx.pinned) return s.phase === "shown" ? s : show(s, now);
  if (s.phase === "shown" && !held(s) && now - s.lastInputAt >= HIDE_AFTER_MS) {
    return ctx.fadeMs > 0 ? { ...s, phase: "fading", fadeEndsAt: now + ctx.fadeMs } : { ...s, phase: "hidden", fadeEndsAt: null };
  }
  if (s.phase === "fading" && s.fadeEndsAt !== null && now >= s.fadeEndsAt) return { ...s, phase: "hidden", fadeEndsAt: null };
  return s;
}

/** When `tick` may next change something, or null when nothing will change without an input. */
export function nextChangeAt(s: BandState, ctx: BandContext): number | null {
  if (ctx.pinned) return null;
  if (s.phase === "shown") return held(s) ? null : s.lastInputAt + HIDE_AFTER_MS;
  return s.phase === "fading" ? s.fadeEndsAt : null;
}
