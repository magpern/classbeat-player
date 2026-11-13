// The offline class cache, in the app's own folder (plan, section 5, "Offline"): one file per
// class, each written atomically (a new file, flushed, then renamed over the old), and the sync
// cursor with the key of the account it belongs to. Readable by this user only. Nothing here logs.
//
//   <dir>/sync.json          {"v":1,"account":"<key>","cursor":<n>}
//   <dir>/classes/<id>.json  {"v":1,"hash":"sha256:…","document":{…}}
//
// A file that does not read back as exactly this is dropped, never guessed at. A class is read
// for play only when its document still has the hash it was kept with.
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { contentHash } from "classformat/src/index.ts";
import { isClassId } from "../../core/sync/answers.ts";
import { readCapped } from "../capped-read.ts";

export interface StoredSync {
  readonly account: string | null;
  readonly cursor: number;
  /** Class id to content hash. */
  readonly held: ReadonlyMap<string, string>;
}

export interface ClassCache {
  load(): StoredSync;
  /** Throws when the class could not be kept. */
  keep(id: string, hash: string, document: Readonly<Record<string, unknown>>): void;
  /** Throws when one of them could not be deleted. */
  remove(ids: readonly string[]): void;
  /** Throws when the cursor could not be kept. */
  commit(account: string, cursor: number): void;
  /** The document, only when it still has the hash it was kept with; null otherwise. */
  read(id: string): { readonly hash: string; readonly document: Readonly<Record<string, unknown>> } | null;
  /** Deletes every class and the cursor. Throws when the folder could not be deleted. */
  wipe(): void;
}

export const SYNC_FILE = "sync.json";
export const CLASSES_DIR = "classes";
/** A class document is at most 1 MiB (ADR 0002, section 7); a bigger file is refused unread. */
export const MAX_CACHED_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SYNC_FILE_BYTES = 4096;
const HASH = /^sha256:[0-9a-f]{64}$/;
const KEY = /^[0-9a-f]{64}$/;
const FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function readJson(file: string, max: number): unknown {
  try {
    const data = readCapped(file, max);
    return data === null ? undefined : JSON.parse(data.toString("utf8"));
  } catch {
    return undefined;
  }
}

/** Writes `text` to `file` so that a reader sees the old file or the new one, never a part. */
function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  // A stale temporary file, or a link planted there, is removed (the link, never its target); the
  // new one is then created exclusively, so nothing that appears meanwhile is followed.
  rmSync(tmp, { force: true });
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** `account` is an opaque key (64 hex characters), never an address or a token. */
export function classCache(dir: string): ClassCache {
  const classes = join(dir, CLASSES_DIR);
  const classFile = (id: string): string => {
    // The id names a file, so only the contract's own form is ever used in a path.
    if (!isClassId(id)) throw new Error("not a class id");
    return join(classes, `${id}.json`);
  };
  const ensure = (): void => void mkdirSync(classes, { recursive: true, mode: 0o700 });
  const entry = (id: string): { hash: string; document: Record<string, unknown> } | null => {
    const raw = readJson(classFile(id), MAX_CACHED_FILE_BYTES);
    if (!isObject(raw) || raw.v !== 1 || typeof raw.hash !== "string" || !HASH.test(raw.hash) || !isObject(raw.document)) return null;
    return { hash: raw.hash, document: raw.document };
  };

  return {
    load() {
      const meta = readJson(join(dir, SYNC_FILE), MAX_SYNC_FILE_BYTES);
      const ok = isObject(meta) && meta.v === 1 && typeof meta.account === "string" && KEY.test(meta.account) && Number.isSafeInteger(meta.cursor) && (meta.cursor as number) >= 0;
      const held = new Map<string, string>();
      let names: string[] = [];
      try {
        names = readdirSync(classes);
      } catch {
        // No folder yet: nothing is held.
      }
      for (const name of names) {
        const id = name.match(FILE)?.[1];
        const found = id === undefined ? null : entry(id);
        if (id !== undefined && found !== null) held.set(id, found.hash);
        // A leftover temporary file or a class file that does not read back is dropped.
        else if (id !== undefined || name.endsWith(".json.tmp")) rmSync(join(classes, name), { force: true });
      }
      return ok ? { account: meta.account as string, cursor: meta.cursor as number, held } : { account: null, cursor: 0, held };
    },
    keep(id, hash, document) {
      if (!HASH.test(hash)) throw new Error("not a content hash");
      const file = classFile(id);
      ensure();
      writeAtomic(file, JSON.stringify({ v: 1, hash, document }));
    },
    remove(ids) {
      for (const id of ids) rmSync(classFile(id), { force: true });
    },
    commit(account, cursor) {
      if (!KEY.test(account) || !Number.isSafeInteger(cursor) || cursor < 0) throw new Error("not a cursor");
      ensure();
      writeAtomic(join(dir, SYNC_FILE), JSON.stringify({ v: 1, account, cursor }));
    },
    read(id) {
      try {
        const found = entry(id);
        return found !== null && contentHash(found.document) === found.hash ? found : null;
      } catch {
        return null;
      }
    },
    wipe() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
