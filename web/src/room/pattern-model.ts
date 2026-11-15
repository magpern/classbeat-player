// The position pattern as the room screen words it (docs/design/room-2d.md, "A position pattern,
// folded into the Position metric"). Pure: what the Position metric reads, from the interval, the
// song, the link and the player's count. The count is shown only while the music is followed and
// the song has what the count needs; it is never guessed here.
import type { Class, LinkInput, PatternInput } from "./input.ts";
import type { PatternValue } from "./model.ts";
import { songBpm } from "./score.ts";

type Interval = Class["intervals"][number];
type Song = Class["songs"][number];
type Side = "seated" | "standing";

/** The words for the rider: UP is standing, DOWN is seated (no hand icon, rule 8). */
export const sideWord = (p: Side): "UP" | "DOWN" => (p === "standing" ? "UP" : "DOWN");

/** "4 up, 4 down, 8 up": the next row names a pattern in words. */
export function patternWords(pattern: NonNullable<Interval["pattern"]>): string {
  return pattern.positions.map((p, i) => `${pattern.beats[i]} ${p === "standing" ? "up" : "down"}`).join(", ");
}

export const NOTE_NO_COUNT = "Count from the music";
export const NOTE_NO_TEMPO = "No tempo: count from the music";
export const NOTE_STARTS_SOON = "Starts on the next bar";

/** The song's own beat anchors (the grid the count rests on), not just a listed tempo. */
function hasAnchors(song: Song): boolean {
  const a = song.beat_anchors;
  return !!a && a.quality !== "missing" && a.anchors.length > 0;
}

const hasTempo = (song: Song): boolean => songBpm(song) !== null;

/** The link follows the music and holds a lock now (not coasting, off the list, paused, held or manual). */
const locked = (link: LinkInput | null): boolean => link?.mode === "following" && link.state === "Locked" && !link.held;

/**
 * What the Position metric shows in a pattern interval:
 * - beat known: the side and the beats left (the player's count);
 * - `next_downbeat`, the first downbeat not yet come: the side of the first entry and "Starts on the next bar";
 * - otherwise a note: "No tempo: count from the music" when the song has no tempo, else "Count from the music".
 */
export function patternValue(iv: Interval, song: Song | null, link: LinkInput | null, snapshot: PatternInput | null): PatternValue | null {
  const pat = iv.pattern;
  if (!pat) return null;
  if (!locked(link) || !song) return { kind: "note", text: NOTE_NO_COUNT };
  if (!hasTempo(song)) return { kind: "note", text: NOTE_NO_TEMPO };
  const onDownbeat = pat.start_on === "next_downbeat";
  // Tempo only: an interval-start pattern counts at the bpm; a next-downbeat one needs the grid.
  if (onDownbeat && !hasAnchors(song)) return { kind: "note", text: NOTE_NO_COUNT };
  if (snapshot) return { kind: "count", side: sideWord(snapshot.position), count: String(snapshot.beatsLeft) };
  if (onDownbeat) return { kind: "soon", side: sideWord(pat.positions[0]), text: NOTE_STARTS_SOON };
  return { kind: "note", text: NOTE_NO_COUNT };
}

/** The song has no tempo: the Song metric and the bars line follow the Position note. */
export const isNoTempo = (v: PatternValue | null): boolean => v?.kind === "note" && v.text === NOTE_NO_TEMPO;

/** The Position metric as plain text (what the screen reads out, and what tests compare). */
export function patternText(v: PatternValue): string {
  return v.kind === "count" ? `${v.side} ${v.count}` : v.kind === "soon" ? `${v.side}, ${v.text}` : v.text;
}
