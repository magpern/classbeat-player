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

/** The link plate, in the words of the plain screen (web/src/room/link-text.ts): quiet while following, white (alert) when the music is not followed (ADR 0001). */
export function linkWords(link: TextLink, cls: Pick<TextClass, "following">, playlistNotLoaded = false): { text: string; alert: boolean } {
  const following = link.mode === "following";
  // A mix class: the player's line, only its fixed words (web/src/room/link-text.ts: it comes before every other plate). White for news, as the plain screen's white square.
  if (link.mix !== undefined) return { text: link.mix.text, alert: link.mix.shape === "news" };
  // "Playlist not loaded" (scene.md, the states table): white, in the place of the quiet states of a followed class (Locked, or "Manual" before the first lock),
  // before the start too; never in place of a link fault or the real manual clock.
  if (playlistNotLoaded && following && (link.state === "Locked" || link.state === "Manual")) return { text: "Playlist not loaded", alert: true };
  if (link.started === false) return following ? { text: "Waiting for the first song", alert: false } : { text: "Press Start", alert: false };
  if (following && link.state === "Manual") return { text: "Waiting for the first song", alert: false };
  switch (link.state) {
    case "Paused": return { text: "Music paused", alert: true };
    case "Coasting": return { text: "Music not heard", alert: true };
    case "Off the list": return { text: "Not a class song", alert: true };
    case "Ambiguous": return { text: "Song is in twice", alert: true };
    case "Manual":
      if (link.mode === "manual" && link.announcement === true) return { text: "Following stopped", alert: true };
      return link.mode === "manual" && link.available === true ? { text: "Manual \u00b7 F to follow", alert: false } : { text: "Manual clock", alert: false };
    default: return { text: cls.following, alert: false };
  }
}

/** The link marker's shape (scene.md "Link markers in the text layer", room-2d.md States): a round dot while the music is followed, a square for the manual clock, its prompts ("Press Start", "Manual \u00b7 F to follow", "Following stopped") and the "Playlist not loaded" plate. A fault plate keeps its own square (the .alert style). */
export function linkMarker(plate: { text: string; alert: boolean }, link: TextLink): "round" | "square" {
  if (plate.alert) return "square";
  if (link.mix !== undefined) return "round";
  return plate.text === "Press Start" || plate.text === "Manual clock" || plate.text === "Manual \u00b7 F to follow" ? "square" : "round";
}
