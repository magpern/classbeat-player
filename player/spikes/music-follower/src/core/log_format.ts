// JSON-lines formatting of the spike log. Pure: returns strings, writes nothing.
import type { Decision, Reading } from "./types.js";

export interface Stamp {
  monoMs: number;
  wallMs: number;
}

export function metaLine(stamp: Stamp, info: Record<string, unknown>): string {
  return JSON.stringify({ t: "meta", ...stamp, ...info });
}

export function readingLine(stamp: Stamp, reading: Reading | null, decision: Decision): string {
  return JSON.stringify({ t: "reading", ...stamp, reading, decision });
}

export function markerLine(stamp: Stamp, key: string, classTimeMs: number | null): string {
  return JSON.stringify({ t: "marker", ...stamp, key, classTimeMs });
}

/** A control key (undo, relink, pick) and the decision it produced. */
export function controlLine(stamp: Stamp, key: string, decision: Decision): string {
  return JSON.stringify({ t: "control", ...stamp, key, decision });
}

/** The status text plus, when the music gives no usable reading, why. */
export function statusLine(d: Decision, why: string | null): string {
  return statusText(d) + (why ? `  [no music reading: ${why}]` : "");
}

/** Shown while a read has been pending for a while (Spotify or macOS not answering yet). */
export function pendingNote(elapsedMs: number): string {
  return elapsedMs < 1000 ? "" : `  [waiting for Spotify's answer, ${Math.floor(elapsedMs / 1000)} s]`;
}

/** One-line status for the terminal. */
export function statusText(d: Decision): string {
  const s = Math.floor(d.classTimeMs / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const ann = d.announce ? `  ** ${d.announce} (u = undo)` : "";
  const pick = d.state === "Ambiguous" ? `  pick the song: ${d.candidates.map((i) => i + 1).join(" or ")} (press its number)` : "";
  return `${mm}:${ss}  ${d.state}${d.held ? " (hold)" : ""}  song ${d.songIndex === null ? "-" : d.songIndex + 1}${ann}${pick}`;
}
