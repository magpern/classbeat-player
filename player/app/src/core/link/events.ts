// Naming what a following step did (for the log, the tests and the announcement). Pure.
import type { LinkConfig, LinkEvent, LinkStateName } from "./types.ts";

export interface StepFacts {
  readonly prev: LinkStateName;
  readonly next: LinkStateName;
  readonly prevSong: number | null;
  readonly nextSong: number;
  /** First time a song is followed on a clock the instructor had not started. */
  readonly firstLock: boolean;
  /** Going to where the music is after coasting, being off the list or the manual clock. */
  readonly resync: boolean;
  readonly ambiguous: boolean;
  /** Target minus where the clock was. */
  readonly deltaMs: number;
  /** A small backward step was smoothed out (rule 4). */
  readonly smoothed: boolean;
}

export function classify(f: StepFacts, cfg: Pick<LinkConfig, "seekMs">): LinkEvent | null {
  if (f.firstLock) return f.ambiguous ? "ambiguous" : "locked";
  if (f.resync) return f.prev === "Ambiguous" ? "resolved" : f.ambiguous ? "ambiguous" : "relock";
  if (f.prevSong !== f.nextSong) return "song_change";
  if (!f.smoothed && Math.abs(f.deltaMs) > cfg.seekMs) return "seek";
  if (!f.smoothed && f.deltaMs < 0) return "backward";
  if (f.prev === "Paused" && f.next === "Locked") return "resume";
  if (f.prev === "Locked" && f.next === "Paused") return "pause";
  if (f.next === "Ambiguous" && f.prev !== "Ambiguous") return "ambiguous";
  return null;
}

/** "resynced, 30 s back": the text of a correction over the announce threshold. */
export function resyncText(deltaMs: number): string {
  return `resynced, ${Math.round(Math.abs(deltaMs) / 1000)} s ${deltaMs < 0 ? "back" : "forward"}`;
}
