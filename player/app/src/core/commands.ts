// The presenter's commands to the shell, and the shape check every IPC message passes before
// it is used. Pure. Anything not exactly one of these shapes is refused (null).
import { JUMP_MS } from "./clock/clock.ts";
import { MAX_CLASS_FILE_BYTES } from "./class-file.ts";

export type ClockCommand =
  | { readonly type: "start" }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "next" }
  | { readonly type: "previous" }
  | { readonly type: "jump"; readonly deltaMs: 5000 | -5000 }
  // The music link's controls (ADR 0001): undo a resync, choose the manual clock, follow the
  // music again, pick one occurrence of a repeated recording.
  | { readonly type: "undo" }
  | { readonly type: "manual" }
  | { readonly type: "follow" }
  | { readonly type: "pick"; readonly songIndex: number };

export interface DroppedFile {
  readonly name: string;
  readonly text: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const hasOnly = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).every((k) => keys.includes(k)) && keys.every((k) => k in v);

const SIMPLE = new Set(["start", "pause", "resume", "next", "previous", "undo", "manual", "follow"]);
const MAX_SONG_INDEX = 999;

export function parseClockCommand(v: unknown): ClockCommand | null {
  if (!isPlainObject(v) || typeof v.type !== "string") return null;
  if (SIMPLE.has(v.type)) return hasOnly(v, ["type"]) ? ({ type: v.type } as ClockCommand) : null;
  if (v.type === "jump" && hasOnly(v, ["type", "deltaMs"]) && (v.deltaMs === JUMP_MS || v.deltaMs === -JUMP_MS)) {
    return { type: "jump", deltaMs: v.deltaMs === JUMP_MS ? 5000 : -5000 };
  }
  if (v.type === "pick" && hasOnly(v, ["type", "songIndex"]) && Number.isInteger(v.songIndex)) {
    const i = v.songIndex as number;
    return i >= 0 && i <= MAX_SONG_INDEX ? { type: "pick", songIndex: i } : null;
  }
  return null;
}

export const MAX_FILE_NAME_LENGTH = 255;

/** A class file dropped on the presenter: its name and its text, nothing else (never a path). */
export function parseDroppedFile(v: unknown): DroppedFile | null {
  if (!isPlainObject(v) || !hasOnly(v, ["name", "text"])) return null;
  const { name, text } = v;
  if (typeof name !== "string" || name.length > MAX_FILE_NAME_LENGTH) return null;
  // A UTF-8 encoding is never shorter than the UTF-16 length, so this refuses early what the
  // exact byte check in readClassText would refuse anyway.
  if (typeof text !== "string" || text.length > MAX_CLASS_FILE_BYTES) return null;
  return { name, text };
}
