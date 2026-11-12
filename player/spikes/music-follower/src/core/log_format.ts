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

/** One-line status for the terminal. */
export function statusText(d: Decision): string {
  const s = Math.floor(d.classTimeMs / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const ann = d.announce ? `  ** ${d.announce} (u = undo)` : "";
  const pick = d.state === "Ambiguous" ? `  pick the song: ${d.candidates.map((i) => i + 1).join(" or ")} (press its number)` : "";
  return `${mm}:${ss}  ${d.state}${d.held ? " (hold)" : ""}  song ${d.songIndex === null ? "-" : d.songIndex + 1}${ann}${pick}`;
}
