// What the class list window may know of a local class's music files (docs/design/music-files.md):
// the state, the number of songs and, for each song whose file is missing, the class document's own
// title, artist and `file_name`. Built field by field from the document and the per-song answer
// (`found` or `missing`), so nothing from the disk can ride along: no path, no folder, no hash, no
// name of a file that was found. The three texts are neutralised (safe-text.ts). Pure.
import type { FindAnswer } from "./answer.ts";
import type { ClassRow } from "../sync/class-list.ts";
import { safeText } from "./safe-text.ts";

/** What the main process is doing for the class: `idle`, or the check or find that holds Start. */
export type FilesPhase = "idle" | "checking" | "choosing" | "finding";

export interface MissingSong {
  readonly title: string;
  readonly artist: string;
  /** `ids.local_file.file_name` from the class document: a hint for the eyes, never a path. */
  readonly fileName: string;
}

export interface FilesView {
  readonly id: string;
  readonly hash: string;
  readonly phase: FilesPhase;
  readonly total: number;
  readonly missing: readonly MissingSong[];
  /** A find ended with files still missing: the words are "still missing". */
  readonly searched: boolean;
  /** The last `player:music-files-find` failed: a plate with "Try again". */
  readonly failed: boolean;
}

/** What the class list controller asks of the files state (main/music-files/files-state.ts implements it): views, never a path. */
export interface FilesPort {
  /** The state of every local row; starts the check of any row not yet answered. */
  view(rows: readonly ClassRow[]): readonly FilesView[];
  /** True while the class's check or find runs or has not answered: Start waits. */
  held(classId: string, hash: string): boolean;
  /** Every answer is dropped and asked again: a class ended, or the account changed. */
  reset(): void;
}

const isObject =(v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? safeText(v) : "");

export interface FilesInput {
  readonly id: string;
  readonly hash: string;
  readonly doc: unknown;
  /** The latest check or find, or null before one answered. */
  readonly answer: FindAnswer | null;
  readonly phase: FilesPhase;
  readonly searched: boolean;
  readonly failed: boolean;
}

/**
 * The view of one local class, or null when the document is not a class with songs. An answer that
 * is not `done`, or whose song count is not the document's, counts every song as missing: a song
 * is found only when it was found and checked (the manual clock is what Start would give).
 */
export function filesViewOf(i: FilesInput): FilesView | null {
  const songs = isObject(i.doc) && Array.isArray(i.doc.songs) ? i.doc.songs : null;
  if (songs === null || songs.length === 0) return null;
  const states = i.answer !== null && i.answer.status === "done" && i.answer.songs.length === songs.length ? i.answer.songs : null;
  const missing: MissingSong[] = [];
  songs.forEach((s, k) => {
    if (states?.[k] === "found") return;
    const song = isObject(s) ? s : {};
    const file = isObject(song.ids) && isObject(song.ids.local_file) ? song.ids.local_file : {};
    missing.push({ title: text(song.title), artist: text(song.artist), fileName: text(file.file_name) });
  });
  return { id: i.id, hash: i.hash, phase: i.phase, total: songs.length, missing, searched: i.searched, failed: i.failed };
}
