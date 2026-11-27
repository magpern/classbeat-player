// The files a class with music source `local` wants (ADR 0017 sections 1 and 2): per song, in song
// order, the SHA-256 of the whole file and its size in bytes. Pure. The class document's
// `file_name` is a hint for the instructor's eyes only and is never read here: matching uses the
// content alone, never a name, tags or a date.

export interface WantedFile {
  /** 64 lowercase hex characters. */
  readonly sha256: string;
  /** A positive whole number of bytes. */
  readonly size: number;
}

/** The format caps a class's songs well below this; a bigger list is not a class we can match. */
export const MAX_SONGS = 1000;
const SHA256 = /^[0-9a-f]{64}$/;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** One song's file, or null when the song has none or it is not exactly the format's shape. */
function wantedOf(song: unknown): WantedFile | null {
  if (!isObject(song) || !isObject(song.ids)) return null;
  const f = song.ids.local_file;
  if (!isObject(f)) return null;
  const { sha256, size_bytes: size } = f;
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1) return null;
  return { sha256, size };
}

/**
 * Every song's file, in song order, when the class's music source is `local` and every song names
 * its file. Null for any other class, or a document that is not that shape: nothing is matched.
 */
export function wantedFiles(doc: unknown): readonly WantedFile[] | null {
  if (!isObject(doc) || !isObject(doc.music) || doc.music.source !== "local") return null;
  const songs = doc.songs;
  if (!Array.isArray(songs) || songs.length === 0 || songs.length > MAX_SONGS) return null;
  const out: WantedFile[] = [];
  for (const s of songs) {
    const w = wantedOf(s);
    if (w === null) return null;
    out.push(w);
  }
  return out;
}

/** The hashes still missing, each with the sizes the class gives it. */
export function missingOf(wanted: readonly WantedFile[], found: ReadonlySet<string>): Map<string, number> {
  return new Map(wanted.filter((w) => !found.has(w.sha256)).map((w) => [w.sha256, w.size]));
}
