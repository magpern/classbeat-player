// The words and numbers the room screen shows (room-2d.md "Fitting text", scene.md "Intervals
// first"): clocks, ranges, sides, the pattern in words and the music link's plate. Pure.

import type { Cadence, Side, TextClass, TextLink, TextPattern } from "./text-types.ts";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** M:SS, and H:MM:SS from one hour; whole seconds, rounded down. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** The countdown: M:SS, minutes only (never hours); 100 minutes or more reads 99+. */
export function countdownText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return total >= 6000 ? "99+" : `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

/** Class time in the rail: MM:SS, H:MM:SS from one hour. */
export function classTimeText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return total >= 3600 ? clockText(ms) : `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function cadenceWords(c: Cadence | null): { value: string; unit: string | null } {
  if (c === null) return { value: "–", unit: null };
  return c === "beat" ? { value: "On the beat", unit: null } : { value: `${c.from}–${c.to}`, unit: "rpm" };
}

export const positionWord = (p: Side | null): string => (p === "standing" ? "Standing" : p === "seated" ? "Seated" : "–");
/** UP is standing and DOWN is seated: words, no hand icon (rule 8). */
export const sideWord = (p: Side): "UP" | "DOWN" => (p === "standing" ? "UP" : "DOWN");
const lower = (p: Side): string => (p === "standing" ? "up" : "down");

/** "4 up, 4 down, 8 up". */
export function patternWords(p: TextPattern): string {
  return p.positions.map((side, i) => `${p.beats.at(i) ?? 0} ${lower(side)}`).join(", ");
}

/**
 * The next row's spec, longest form first: cadence and position (or the pattern in words), then
 * without the unit, then the position or pattern alone. The row takes the longest that fits.
 */
/** A running interval's target in words (running-class.md, item 1). */
export const inclineWords = (incline: "flat" | "raised"): string => (incline === "raised" ? "Incline raised" : "Incline flat");

export function specForms(cadence: Cadence | null, position: Side | null, pattern: TextPattern | null, incline?: "flat" | "raised"): string[] {
  if (incline !== undefined) return [inclineWords(incline)];
  const c = cadence === null ? null : cadenceWords(cadence);
  const tail = pattern ? patternWords(pattern) : position ? positionWord(position) : null;
  const join = (parts: (string | null)[]): string => parts.filter((p): p is string => p !== null).join(" ");
  const forms = [join([c === null ? null : c.unit === null ? c.value : `${c.value} ${c.unit}`, tail]), join([c?.value ?? null, tail]), join([tail])];
  return forms.filter((f, i) => f !== "" && forms.indexOf(f) === i);
}

export function barsText(bars: number, last: boolean): string {
  return `${bars} ${bars === 1 ? "bar" : "bars"} ${last ? "to the end" : "to the change"}`;
}

export type LinkKind = "round" | "square" | "ring";
export interface LinkPlate { text: string; alert: boolean; kind: LinkKind }

/** A mix line's marker follows its shape as on the plain screen (web/src/room/mix-words.ts): dot round, circle a ring, square and news square. */
const mixKind = (shape: "dot" | "circle" | "square" | "news"): LinkKind => (shape === "dot" ? "round" : shape === "circle" ? "ring" : "square");

/**
 * The link plate and its marker, decided from the link and mix state, never from the words (scene.md "Link markers in the text layer", room-2d.md States):
 * round while the music is followed, square for the manual clock and its prompts and for every white plate, a ring for a mix download.
 */
export function linkPlate(link: TextLink, cls: Pick<TextClass, "following">, playlistNotLoaded = false): LinkPlate {
  const following = link.mode === "following";
  // A mix class: the player's line, only its fixed words (web/src/room/link-text.ts: it comes before every other plate). White for news, as the plain screen's white square.
  if (link.mix !== undefined) return { text: link.mix.text, alert: link.mix.shape === "news", kind: mixKind(link.mix.shape) };
  // "Playlist not loaded" (scene.md, the states table): white, in the place of the quiet states of a followed class (Locked, or "Manual" before the first lock),
  // before the start too; never in place of a link fault or the real manual clock.
  if (playlistNotLoaded && following && (link.state === "Locked" || link.state === "Manual")) return { text: "Playlist not loaded", alert: true, kind: "square" };
  if (link.started === false) return following ? { text: "Waiting for the first song", alert: false, kind: "round" } : { text: "Press Start", alert: false, kind: "square" };
  if (following && link.state === "Manual") return { text: "Waiting for the first song", alert: false, kind: "round" };
  switch (link.state) {
    case "Paused": return { text: "Music paused", alert: true, kind: "square" };
    case "Coasting": return { text: "Music not heard", alert: true, kind: "square" };
    case "Off the list": return { text: "Not a class song", alert: true, kind: "square" };
    case "Ambiguous": return { text: "Song is in twice", alert: true, kind: "square" };
    case "Manual":
      if (link.mode === "manual" && link.announcement === true) return { text: "Following stopped", alert: true, kind: "square" };
      return { text: link.mode === "manual" && link.available === true ? "Manual \u00b7 F to follow" : "Manual clock", alert: false, kind: "square" };
    default: return { text: cls.following, alert: false, kind: "round" };
  }
}

/** The link plate, in the words of the plain screen (web/src/room/link-text.ts): quiet while following, white (alert) when the music is not followed (ADR 0001). */
export function linkWords(link: TextLink, cls: Pick<TextClass, "following">, playlistNotLoaded = false): { text: string; alert: boolean } {
  const { text, alert } = linkPlate(link, cls, playlistNotLoaded);
  return { text, alert };
}
