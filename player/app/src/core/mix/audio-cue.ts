// What passes between the shell and the room window's <audio> during mix playback (ADR 0013
// sections 4 and 5). Pure. The shell sends a cue: the play URL (or none: stop), whether to play,
// and the mix position. The room answers with a report of where the audio is; the shell parses it
// strictly and steers the class clock to `audio position - offset_ms` when the two drift apart.
import { playIdOf } from "./scheme-policy.ts";

/** What the room window's <audio> is told to do. `url` null: no mix plays, the audio is emptied. */
export interface MixCue {
  /** Grows with every cue; a report names the cue it answers, so a late one is dropped. */
  readonly seq: number;
  readonly url: string | null;
  readonly playing: boolean;
  /** The mix position to be at, in ms (class time + offset_ms). */
  readonly positionMs: number;
}

export const NO_CUE: MixCue = { seq: 0, url: null, playing: false, positionMs: 0 };

/** What the room says about its <audio>: where it is, whether it plays, and whether it failed. */
export interface AudioReport {
  readonly seq: number;
  readonly positionMs: number;
  readonly playing: boolean;
  /** The element gave up (a load or decode error, or a stall the shell's reader ended). */
  readonly failed: boolean;
}

const KEYS = ["failed", "playing", "positionMs", "seq"];
/** About 27 hours: no mix is longer, and the number stays an exact integer. */
const MAX_MS = 100_000_000;

/** A report exactly as the room sends it, or null: four fields, nothing else, each of its type and range. */
export function parseAudioReport(raw: unknown): AudioReport | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).sort().join() !== KEYS.join()) return null;
  const { seq, positionMs, playing, failed } = r;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1) return null;
  if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0 || positionMs > MAX_MS) return null;
  if (typeof playing !== "boolean" || typeof failed !== "boolean") return null;
  return { seq: seq as number, positionMs: Math.round(positionMs), playing, failed };
}

/** The clock follows the audio when they are further apart than this (ADR 0001's accuracy target). */
export const DRIFT_MS = 250;

/**
 * The class time the clock should be at, or null when it is close enough. `classMs`: the clock now;
 * `audioMs`: the audio position reported; never below 0 nor past the class's length.
 */
export function steer(classMs: number, audioMs: number, offsetMs: number, lengthMs: number): number | null {
  const want = Math.min(Math.max(audioMs - offsetMs, 0), lengthMs);
  return Math.abs(want - classMs) > DRIFT_MS ? want : null;
}

/** The mix position for a class time. */
export const mixPositionOf = (classMs: number, offsetMs: number): number => classMs + offsetMs;

/** A closed copy of a cue: the four fields and nothing else cross to the room window. */
export const mixCueOf = (c: MixCue): MixCue => ({ seq: c.seq, url: c.url, playing: c.playing, positionMs: c.positionMs });

const CUE_KEYS = ["playing", "positionMs", "seq", "url"];

/** A cue exactly as the shell sends it, or null: the URL is none or a play URL, nothing else. */
export function parseMixCue(raw: unknown): MixCue | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).sort().join() !== CUE_KEYS.join()) return null;
  const { seq, url, playing, positionMs } = r;
  if (!Number.isSafeInteger(seq) || (seq as number) < 0) return null;
  if (url !== null && (typeof url !== "string" || playIdOf(url) === null)) return null;
  if (typeof playing !== "boolean") return null;
  if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0 || positionMs > MAX_MS) return null;
  return { seq: seq as number, url: url as string | null, playing, positionMs };
}
