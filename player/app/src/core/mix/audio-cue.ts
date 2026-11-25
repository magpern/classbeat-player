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
  /** The length the element decoded, in ms, or null while it does not know it yet. */
  readonly durationMs: number | null;
}

const KEYS = ["durationMs", "failed", "playing", "positionMs", "seq"];
/** About 27 hours: no mix is longer, and the number stays an exact integer. */
const MAX_MS = 100_000_000;

/** A report exactly as the room sends it, or null: five fields, nothing else, each of its type and range. */
export function parseAudioReport(raw: unknown): AudioReport | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).sort().join() !== KEYS.join()) return null;
  const { seq, positionMs, playing, failed, durationMs } = r;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1) return null;
  if (!isMs(positionMs)) return null;
  if (typeof playing !== "boolean" || typeof failed !== "boolean") return null;
  if (durationMs !== null && !isMs(durationMs)) return null;
  return { seq: seq as number, positionMs: Math.round(positionMs), playing, failed, durationMs: durationMs === null ? null : Math.round(durationMs) };
}

const isMs = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_MS;

/**
 * The clock follows the audio when they are further apart than this. ADR 0001's tighter target is
 * the one that binds: beat effects within 50 ms of the music (interval timing, about 1 s, follows
 * from it). 30 ms leaves 10 ms for the report's trip from the room to the shell and 10 ms for the
 * two clocks to drift apart in the second between reports (checked on the fake in mix-player.test.ts).
 */
export const DRIFT_MS = 30;

/** A decoded length further than this from the class's `length_ms` means the mix is not used (ADR 0013 section 3). */
export const LENGTH_TOLERANCE_MS = 1000;

/** The decoded length is known and too far from the length the class was designed against. */
export const wrongLength = (durationMs: number | null, lengthMs: number): boolean => durationMs !== null && Math.abs(durationMs - lengthMs) > LENGTH_TOLERANCE_MS;

/**
 * The class time the clock should be at, or null when it is close enough. `classMs`: the clock now;
 * `audioMs`: the audio position reported; `classLengthMs`: the class's length. The result is never
 * below 0 nor past the class's end (the mix can run on after it).
 */
export function steer(classMs: number, audioMs: number, offsetMs: number, classLengthMs: number): number | null {
  const want = Math.min(Math.max(audioMs - offsetMs, 0), classLengthMs);
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
