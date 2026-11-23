// The hold after an unforeseen cause (scene.md "How a beam turns", item 1, decided in #592 and #617). A seek or a
// jump, a reload, a lost or regained lock and a resume cannot be foreseen, so the limiter keeps every beam on its
// present aim for 2 s of class-clock time and only then takes the target. The hold's inputs are the cause and the
// class clock: no interval, zone, target or run reaches it (rule 4). Pure.

import type { LinkInput } from "./beat-level.ts";
import { rigFrozen } from "./link-gate.ts";
import type { PlacedRun } from "./flash-runs.ts";

/** `--scene-unforeseen-hold`: P2's longest lateness, 1 s, plus 1 s, so the scheduler sees the turn coming. */
export const UNFORESEEN_HOLD_MS = 2000;
/** The class clock moves by more than this between two frames, or backwards: a seek or a jump, a person's action (as the text layer sees it). */
export const JUMP_MS = 1000;

export type UnforeseenCause = "seek" | "jump" | "reload" | "lock lost" | "lock regained" | "resume";

const locked = (link: LinkInput): boolean => link.state === "Locked" && link.held !== true;

/** A link event the scheduler did not plan: a resume (the frozen rig runs again), a lost lock or a regained one. Null on the first frame. */
export function linkCause(prev: LinkInput | null, now: LinkInput): UnforeseenCause | null {
  if (prev === null) return null;
  if (rigFrozen(prev) && !rigFrozen(now)) return "resume";
  if (locked(prev) && !locked(now)) return "lock lost";
  if (!locked(prev) && locked(now)) return "lock regained";
  return null;
}

/** A seek or a jump seen as the class clock moving by more than 1 s, or backwards, between two frames. */
export function clockCause(prevClassMs: number | null, classMs: number): UnforeseenCause | null {
  if (prevClassMs === null) return null;
  return classMs < prevClassMs || classMs - prevClassMs > JUMP_MS ? "seek" : null;
}

/** The class-clock time the hold ends after a cause on this frame; a later cause starts the 2 s again. */
export const holdEnd = (causeClassMs: number): number => causeClassMs + UNFORESEEN_HOLD_MS;

/** Whether the beams are held at this class-clock time: on the class clock, never wall time. */
export const isHeld = (holdUntilMs: number | null, classMs: number): boolean => holdUntilMs !== null && classMs < holdUntilMs;

/**
 * A run in progress when a cause happens ends in the cause's frame (the frame P2 placed for it; as no mark falls inside
 * a run, the run's last piece ends one frame before it): each piece that reaches past the cause's time is cut there, and
 * a piece that starts after the cause's time and before its frame is gone. `causes` pairs the cause's time with its frame.
 */
export function endRunsAtCauses(
  runs: readonly PlacedRun[],
  causes: readonly { readonly atMs: number; readonly frameMs: number }[],
  frameMs: number,
): PlacedRun[] {
  return runs.map((run) => ({
    wish: run.wish,
    pieces: run.pieces.flatMap((p) => {
      const cut = causes.find((c) => p.fromMs < c.frameMs && p.toMs > c.atMs);
      if (cut === undefined) return [p];
      const end = Math.min(p.toMs, cut.frameMs - frameMs);
      return end > p.fromMs && p.fromMs < cut.atMs ? [{ fromMs: p.fromMs, toMs: end }] : [];
    }),
  }));
}
