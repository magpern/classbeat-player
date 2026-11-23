// The rig's per-frame step: the frame-time clamp, the motion phase, the model's frame and the
// turn-rate limiter, in one pure function. The renderer calls it once per frame and draws what it
// returns, so a test that drives it drives the renderer's own loop (scene.md "How a beam turns").
// Nothing here reads a clock: the caller passes the time since the last frame.

import type { Direction } from "./beams.ts";
import type { LinkInput } from "./beat-level.ts";
import { MAX_DEG_PER_SECOND } from "./energy.ts";
import { intervalIndexAt, sceneFrame } from "./frame.ts";
import type { Frame, SceneClass } from "./frame.ts";
import { rigFrozen } from "./link-gate.ts";
import { advancePhase } from "./phase.ts";
import { limitTurn } from "./turn.ts";
import { clockCause, holdEnd, isHeld, linkCause } from "./unforeseen.ts";
import type { UnforeseenCause } from "./unforeseen.ts";

/** A stalled frame or a tab brought back to the front turns a beam by at most 3 degrees. */
export const MAX_FRAME_SECONDS = 0.1;

/** The frame time actually used: at most 100 ms, never negative, never not-a-number. */
export function clampFrameTime(rawSeconds: number): number {
  return rawSeconds > 0 ? Math.min(rawSeconds, MAX_FRAME_SECONDS) : 0;
}

/**
 * What the next frame starts from: the motion phase and what is drawn (null before the first frame), the class-clock time
 * an unforeseen cause's hold ends (null: no hold), and what the last frame saw, to tell a seek or a link event from a steady frame.
 */
export interface RigState {
  readonly phaseDeg: number;
  readonly drawn: readonly Direction[] | null;
  readonly holdUntilMs: number | null;
  readonly lastClassMs: number | null;
  readonly lastLink: LinkInput | null;
}
export const START_STATE: RigState = { phaseDeg: 0, drawn: null, holdUntilMs: null, lastClassMs: null, lastLink: null };

/** The link the still rig is computed with: no phrase, no moments (reduced motion, S11). */
export const STILL_LINK: LinkInput = { state: "Paused" };

export interface StepInput {
  readonly cls: SceneClass;
  readonly classMs: number;
  readonly songIndex: number;
  readonly songPosMs: number;
  readonly link: LinkInput;
  /** Seconds since the last frame, as measured; the step clamps it. */
  readonly rawDtSeconds: number;
  /** Reduced motion: the song's look held still, the phase not advanced; a new look is still turned to. */
  readonly still?: boolean;
  /** Scales the motion phase's rate, 0 to 1 (default 1): off the list and before the start the movement is halved. Never above the zone's row (S7). */
  readonly motion?: number;
  /** The frame is computed as with no music link (level None, no moments) while the rig still moves: before the start. */
  readonly noMusic?: boolean;
  /** A cause the host knows and the step cannot see (a reload that kept the state, a jump the host names); a seek, a lost or regained lock and a resume are seen by the step itself. */
  readonly cause?: UnforeseenCause;
}

export interface Stepped {
  readonly state: RigState;
  /** The model's frame: its `directions` are targets. */
  readonly frame: Frame;
  /** What is drawn this frame, one direction per fixture. */
  readonly drawn: readonly Direction[];
  /** The frame time used, after the clamp. */
  readonly dtSeconds: number;
  /** The beams (and the motion phase) are held on their present aim, 2 s of class-clock time after an unforeseen cause. */
  readonly held: boolean;
  /** The cause seen on this frame, if any. */
  readonly cause: UnforeseenCause | null;
}

/**
 * The drawn directions after one frame: the first frame (no `prev`) starts on the targets, a
 * frozen rig stays where it was, and otherwise each beam turns toward its target by at most 30
 * degrees a second times the clamped frame time.
 */
export function turnToward(prev: readonly Direction[] | null, targets: readonly Direction[], rawDtSeconds: number, frozen: boolean): readonly Direction[] {
  if (prev === null) return targets;
  if (frozen) return prev;
  const maxDegrees = MAX_DEG_PER_SECOND * clampFrameTime(rawDtSeconds);
  return targets.map((target, i) => limitTurn(prev[i] ?? target, target, maxDegrees));
}

export function stepRig(state: RigState, input: StepInput): Stepped {
  const { cls, classMs, songIndex, songPosMs, link, still = false, motion = 1, noMusic = false } = input;
  const dtSeconds = clampFrameTime(input.rawDtSeconds);
  const frozen = rigFrozen(link); // Paused and a hold: the phase and the beams stay where they were
  // An unforeseen cause (scene.md "How a beam turns", item 1) holds the present aim for 2 s of class-clock time; nothing before the first frame.
  const cause = state.drawn === null ? null : (input.cause ?? clockCause(state.lastClassMs, classMs) ?? linkCause(state.lastLink, link));
  const holdUntil = cause === null ? state.holdUntilMs : holdEnd(classMs);
  const held = isHeld(holdUntil, classMs);
  const stopped = frozen || held;
  const zone = cls.intervals[intervalIndexAt(cls, classMs)]?.zone ?? 1;
  const phaseDeg = stopped || still ? state.phaseDeg : advancePhase(state.phaseDeg, dtSeconds, zone, motion);
  const frame = sceneFrame({ cls, classMs, songIndex, songPosMs, phaseDeg, link: still || noMusic ? STILL_LINK : link });
  const drawn = turnToward(state.drawn, frame.directions, dtSeconds, stopped);
  return { state: { phaseDeg, drawn, holdUntilMs: held ? holdUntil : null, lastClassMs: classMs, lastLink: link }, frame, drawn, dtSeconds, held, cause };
}
