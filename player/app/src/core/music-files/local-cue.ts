// What passes between the shell and the room window's two <audio> elements during local playback
// (ADR 0017 section 3). Pure. The shell sends a cue: whether to play and, per element (a slot),
// the play URL of the song it holds (or none), the song position to be at, and the song's fade in,
// fade out and stop, all in the song's own positions. The room answers per slot with a report of
// where that element is; the shell parses it strictly. Song k always plays in slot k % 2, so two
// songs that overlap are never in the same element.
import { localPlayIdOf } from "./local-scheme-policy.ts";

/**
 * A song's gain over its own positions, in ms from its position 0: it fades in over [0, inToMs)
 * (0: no fade in), fades out over [outFromMs, stopMs) (equal: no fade out) and is silent from
 * `stopMs`, where the element pauses.
 */
export interface Fade {
  readonly inToMs: number;
  readonly outFromMs: number;
  readonly stopMs: number;
}

export interface LocalSlotCue {
  readonly url: string | null;
  readonly positionMs: number;
  readonly fade: Fade;
}

export interface LocalCue {
  /** Grows with every cue; a report names the cue it answers, so a late one is dropped. */
  readonly seq: number;
  readonly playing: boolean;
  readonly slots: readonly [LocalSlotCue, LocalSlotCue];
}

export const NO_FADE: Fade = Object.freeze({ inToMs: 0, outFromMs: 0, stopMs: 0 });
export const EMPTY_SLOT: LocalSlotCue = Object.freeze({ url: null, positionMs: 0, fade: NO_FADE });

/** What the room says about one element: where it is, whether it plays, whether it failed, its decoded length. */
export interface LocalReport {
  readonly seq: number;
  readonly slot: 0 | 1;
  readonly positionMs: number;
  readonly playing: boolean;
  readonly failed: boolean;
  /** The length the element decoded, in ms, or null while it does not know it yet. */
  readonly durationMs: number | null;
}

/** About 27 hours: no class is longer, and the number stays an exact integer. */
const MAX_MS = 100_000_000;
const isMs = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_MS;
const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const keysAre = (r: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(r).sort().join() === keys.join();

/**
 * The equal-power gain at song position `p` (ADR 0017 section 3): over an overlap, with x running
 * from 0 to 1, the outgoing song is at cos(x·π/2) and the incoming at sin(x·π/2).
 */
export function gainAt(p: number, f: Fade): number {
  if (!(p >= 0) || p >= f.stopMs) return 0;
  const fadeIn = f.inToMs > 0 && p < f.inToMs ? Math.sin(((p / f.inToMs) * Math.PI) / 2) : 1;
  const span = f.stopMs - f.outFromMs;
  const fadeOut = span > 0 && p > f.outFromMs ? Math.cos((((p - f.outFromMs) / span) * Math.PI) / 2) : 1;
  return Math.min(1, Math.max(0, fadeIn * fadeOut));
}

const fadeOf = (f: Fade): Fade => ({ inToMs: f.inToMs, outFromMs: f.outFromMs, stopMs: f.stopMs });
const slotOf = (s: LocalSlotCue): LocalSlotCue => ({ url: s.url, positionMs: s.positionMs, fade: fadeOf(s.fade) });

/** A closed copy of a cue: these fields and nothing else cross to the room window. */
export const localCueOf = (c: LocalCue): LocalCue => ({ seq: c.seq, playing: c.playing, slots: [slotOf(c.slots[0]), slotOf(c.slots[1])] });

function parseFade(raw: unknown): Fade | null {
  if (!isPlain(raw) || !keysAre(raw, ["inToMs", "outFromMs", "stopMs"])) return null;
  const { inToMs, outFromMs, stopMs } = raw;
  if (!isMs(inToMs) || !isMs(outFromMs) || !isMs(stopMs) || outFromMs > stopMs) return null;
  return { inToMs, outFromMs, stopMs };
}

function parseSlot(raw: unknown): LocalSlotCue | null {
  if (!isPlain(raw) || !keysAre(raw, ["fade", "positionMs", "url"])) return null;
  const { url, positionMs } = raw;
  if (url !== null && localPlayIdOf(url) === null) return null;
  const fade = parseFade(raw.fade);
  if (!isMs(positionMs) || fade === null) return null;
  return { url: url as string | null, positionMs, fade };
}

/** A cue exactly as the shell sends it, or null: each URL is none or a play URL, nothing else. */
export function parseLocalCue(raw: unknown): LocalCue | null {
  if (!isPlain(raw) || !keysAre(raw, ["playing", "seq", "slots"])) return null;
  const { seq, playing, slots } = raw;
  if (!Number.isSafeInteger(seq) || (seq as number) < 0 || typeof playing !== "boolean") return null;
  if (!Array.isArray(slots) || slots.length !== 2 || Object.getPrototypeOf(slots) !== Array.prototype) return null;
  const a = parseSlot(slots[0]);
  const b = parseSlot(slots[1]);
  return a === null || b === null ? null : { seq: seq as number, playing, slots: [a, b] };
}

const REPORT_KEYS = ["durationMs", "failed", "playing", "positionMs", "seq", "slot"];

/** A report exactly as the room sends it, or null: six fields, nothing else, each of its type and range. */
export function parseLocalReport(raw: unknown): LocalReport | null {
  if (!isPlain(raw) || !keysAre(raw, REPORT_KEYS)) return null;
  const { seq, slot, positionMs, playing, failed, durationMs } = raw;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1) return null;
  if (slot !== 0 && slot !== 1) return null;
  if (!isMs(positionMs) || typeof playing !== "boolean" || typeof failed !== "boolean") return null;
  if (durationMs !== null && !isMs(durationMs)) return null;
  return { seq: seq as number, slot, positionMs: Math.round(positionMs), playing, failed, durationMs: durationMs === null ? null : Math.round(durationMs) };
}
