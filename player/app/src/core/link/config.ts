// The link's tuning numbers (ADR 0001). Pure: constants and a type only.

export interface LinkConfig {
  /** Readings older than this (by `seenAt`) are stale: coasting is entered within 3 s. */
  readonly staleMs: number;
  /** Backward corrections up to this are smoothed out (the measuring error). */
  readonly backwardToleranceMs: number;
  /** A same-song jump larger than this is reported as a seek. */
  readonly seekMs: number;
  /** A re-lock correction larger than this is announced, with an undo. */
  readonly announceMs: number;
  /** How long an announcement and its undo stay available. */
  readonly undoWindowMs: number;
  /** A reader's length may differ this much from the class's song length. */
  readonly lengthToleranceMs: number;
}

export const DEFAULT_LINK_CONFIG: LinkConfig = {
  staleMs: 2500,
  backwardToleranceMs: 500,
  seekMs: 1500,
  announceMs: 5000,
  undoWindowMs: 30_000,
  lengthToleranceMs: 2500,
};
