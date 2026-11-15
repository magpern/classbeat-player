// Parse an Android follower log (JSON lines, spike 1's shape). Pure: no I/O.
import type { PlayState, Reading } from "../../../music-follower/src/core/types.js";

export interface LogLine {
  t: string;
  monoMs: number;
  wallMs: number;
  reading?: Reading | null;
  key?: string;
  [extra: string]: unknown;
}

const STATES: PlayState[] = ["playing", "paused", "stopped"];

function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function checkReading(r: unknown, where: string): Reading {
  const o = r as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new Error(`${where}: reading must be an object or null`);
  if (typeof o["title"] !== "string" || typeof o["artist"] !== "string") throw new Error(`${where}: reading needs title and artist`);
  if (!(o["trackId"] === null || typeof o["trackId"] === "string")) throw new Error(`${where}: trackId must be a string or null`);
  if (!STATES.includes(o["state"] as PlayState)) throw new Error(`${where}: state must be playing, paused or stopped`);
  for (const k of ["positionMs", "readAtMs", "polledAtMs"]) if (!num(o[k])) throw new Error(`${where}: ${k} must be a number`);
  return o as unknown as Reading;
}

/** Parses the whole log; the error names the line. Lines must be in the order they were written. */
export function parseLog(text: string): LogLine[] {
  const out: LogLine[] = [];
  let prevMono = -Infinity;
  text.split("\n").forEach((raw, i) => {
    if (raw.trim() === "") return;
    const where = `log line ${i + 1}`;
    let o: LogLine;
    try {
      o = JSON.parse(raw) as LogLine;
    } catch {
      throw new Error(`${where}: not JSON`);
    }
    if (typeof o.t !== "string" || !num(o.monoMs) || !num(o.wallMs)) throw new Error(`${where}: needs t, monoMs and wallMs`);
    if (o.monoMs < prevMono) throw new Error(`${where}: monoMs goes backwards`);
    prevMono = o.monoMs;
    if (o.t === "reading") {
      if (o.reading === undefined) throw new Error(`${where}: reading line has no reading`);
      if (o.reading !== null) o.reading = checkReading(o.reading, where);
    }
    out.push(o);
  });
  return out;
}
