// The quality step rule (scene.md "Quality levels"). Pure: frame times in, level out; no clock, so
// the caller hands every frame's monotonic time. It steps down only and never back up: Plain (the
// plain 2D screen) is the end, and the scene does not come back in that class (a new class starts a
// new monitor).

import { stepDown } from "./quality.ts";
import type { QualityLevel } from "./quality.ts";

export type ShownLevel = QualityLevel | "Plain";

/** A level steps down when its frame rate stays under this (scene.md table). Plain has none. */
export const STEP_BELOW_FPS: Readonly<Record<QualityLevel, number>> = { High: 50, Medium: 45, Low: 30 };
/** ... for this long (ms), measured over whole 1 s windows, so a short dip steps nothing. */
export const STEP_AFTER_MS = 5000;
/** One window of frames is read when it spans at least this long. */
export const WINDOW_MS = 1000;
/** One gap this long between two frames is a pause (hidden window, suspended computer), not a slow scene: it is no evidence. A second long gap right after it is a computer drawing under one frame in 2 s: that is evidence. */
export const PAUSE_MS = 2000;

/** One row of the once-a-second frame-rate log (S9): the whole window's rate and the level it was drawn at. */
export interface SecondRow {
  readonly second: number;
  readonly fps: number;
  readonly level: ShownLevel;
}

export interface MonitorState {
  readonly level: ShownLevel;
  readonly windowStartMs: number | null;
  readonly lastMs: number | null;
  readonly frames: number;
  /** Time spent in consecutive windows under the level's threshold. */
  readonly lowMs: number;
  readonly seconds: number;
  /** The last gap between frames was over the pause limit: a second one in a row is no longer a pause. */
  readonly afterPause: boolean;
}

export interface Observed {
  readonly state: MonitorState;
  /** Set on the frame that closes a window: the log row for it, at the level the window was drawn at. */
  readonly row: SecondRow | null;
  /** True when this frame's window took the level one step down. */
  readonly stepped: boolean;
}

export function startMonitor(level: QualityLevel = "High"): MonitorState {
  return { level, windowStartMs: null, lastMs: null, frames: 0, lowMs: 0, seconds: 0, afterPause: false };
}

/** Take one frame, at `nowMs`. */
export function observe(state: MonitorState, nowMs: number): Observed {
  const long = state.lastMs !== null && nowMs - state.lastMs > PAUSE_MS;
  const restart = state.lastMs === null || nowMs < state.lastMs || (long && !state.afterPause);
  if (restart) return { state: { ...state, windowStartMs: nowMs, lastMs: nowMs, frames: 0, lowMs: 0, afterPause: long }, row: null, stepped: false };
  const frames = state.frames + 1;
  const elapsed = nowMs - (state.windowStartMs ?? nowMs);
  if (elapsed < WINDOW_MS) return { state: { ...state, lastMs: nowMs, frames, afterPause: long }, row: null, stepped: false };
  const fps = (frames * 1000) / elapsed;
  const row: SecondRow = { second: state.seconds, fps, level: state.level };
  const next = { ...state, windowStartMs: nowMs, lastMs: nowMs, frames: 0, seconds: state.seconds + 1, afterPause: long };
  if (state.level === "Plain") return { state: next, row, stepped: false };
  const lowMs = fps < STEP_BELOW_FPS[state.level] ? state.lowMs + elapsed : 0;
  if (lowMs < STEP_AFTER_MS) return { state: { ...next, lowMs }, row, stepped: false };
  return { state: { ...next, level: stepDown(state.level), lowMs: 0 }, row, stepped: true };
}
