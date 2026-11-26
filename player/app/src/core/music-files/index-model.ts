// The local music file index of one classbeat-player account (ADR 0017 section 2), as data. Pure.
// It maps a file's SHA-256 to where it was found, its size and its modification time, and keeps
// the folders the instructor chose. It is the only place a path or a folder from the disk is ever
// kept, and it stays in the main process and in its own file in the app data folder.
//
//   {"v":1,"account":"<key>","folders":["<folder>",…],"files":{"<sha256>":{"path":"…","size":<n>,"mtime_ms":<n>}}}
//
// A file that does not read back as exactly this, or is another account's, is read as empty: an
// index is never guessed at, and a lost index only means the files are searched for again.

export interface IndexedFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface MusicIndex {
  /** The folders chosen, the latest first. */
  readonly folders: readonly string[];
  /** SHA-256 to the file that had it when it was last checked. */
  readonly files: ReadonlyMap<string, IndexedFile>;
}

export const EMPTY_INDEX: MusicIndex = Object.freeze({ folders: Object.freeze([]) as readonly string[], files: new Map<string, IndexedFile>() });

/** Folders remembered; choosing one more forgets the oldest. */
export const MAX_FOLDERS = 16;
/** Files remembered; past this a newly found file is not added. */
export const MAX_ENTRIES = 20_000;
/** Longer than any path the systems we run on accept. */
export const MAX_PATH = 32_767;
const SHA256 = /^[0-9a-f]{64}$/;
const KEY = /^[0-9a-f]{64}$/;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const hasOnly = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const isPath = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_PATH && !v.includes("\u0000");

function fileOf(v: unknown): IndexedFile | null {
  if (!isObject(v) || !hasOnly(v, ["path", "size", "mtime_ms"])) return null;
  const { path, size, mtime_ms: mtimeMs } = v;
  if (!isPath(path) || typeof size !== "number" || !Number.isSafeInteger(size) || size < 1) return null;
  if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) return null;
  return { path, size, mtimeMs };
}

/** The account's index from the file's parsed JSON; empty when it is not exactly that. */
export function parseIndex(v: unknown, account: string): MusicIndex {
  if (!isObject(v) || !hasOnly(v, ["v", "account", "folders", "files"]) || v.v !== 1 || v.account !== account) return EMPTY_INDEX;
  const { folders, files } = v;
  if (!Array.isArray(folders) || folders.length > MAX_FOLDERS || !folders.every(isPath) || !isObject(files)) return EMPTY_INDEX;
  const entries = Object.entries(files);
  if (entries.length > MAX_ENTRIES) return EMPTY_INDEX;
  const out = new Map<string, IndexedFile>();
  for (const [sha, raw] of entries) {
    const f = fileOf(raw);
    if (!SHA256.test(sha) || f === null) return EMPTY_INDEX;
    out.set(sha, f);
  }
  return { folders: [...new Set(folders as string[])], files: out };
}

/** The JSON text of the account's index. */
export function serializeIndex(index: MusicIndex, account: string): string {
  if (!KEY.test(account)) throw new Error("not an account key");
  const files: Record<string, { path: string; size: number; mtime_ms: number }> = {};
  for (const [sha, f] of index.files) files[sha] = { path: f.path, size: f.size, mtime_ms: f.mtimeMs };
  return JSON.stringify({ v: 1, account, folders: index.folders, files });
}

/** The folder chosen goes first; the oldest beyond the cap is forgotten. */
export function rememberFolder(index: MusicIndex, folder: string): MusicIndex {
  if (!isPath(folder)) return index;
  return { folders: [folder, ...index.folders.filter((f) => f !== folder)].slice(0, MAX_FOLDERS), files: index.files };
}

/** Whether two indexes hold the same, so an unchanged one is not written again. */
export function sameIndex(a: MusicIndex, b: MusicIndex): boolean {
  if (a.folders.length !== b.folders.length || a.files.size !== b.files.size || a.folders.some((f, i) => f !== b.folders[i])) return false;
  for (const [sha, f] of a.files) {
    const g = b.files.get(sha);
    if (g === undefined || g.path !== f.path || g.size !== f.size || g.mtimeMs !== f.mtimeMs) return false;
  }
  return true;
}
