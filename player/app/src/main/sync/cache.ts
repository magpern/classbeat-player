// The offline class cache, in the app's own folder (plan, section 5, "Offline"): one file per
// class, each written atomically (a new file, flushed, then renamed over the old), and the sync
// cursor with the key of the account it belongs to. Readable by this user only. Nothing here logs.
//
//   <dir>/sync.json          {"v":1,"account":"<key>","cursor":<n>}
//   <dir>/classes/<id>.json  {"v":1,"account":"<key>","hash":"sha256:…","document":{…}}
//   <dir>/wipe.pending       written before a wipe deletes anything, deleted only once all else is
//
// Every class file names its account. A file that does not read back as exactly this is dropped,
// never guessed at. The cache is loaded only as one account's: a class file of another account,
// or class files with no cursor of their account, mean the cache is wiped before anything syncs.
// While the wipe marker is there nothing is loaded, kept, committed or read for play. A class is
// read for play only when its document still has the hash it was kept with.
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import type { RmOptions } from "node:fs";
import { join } from "node:path";
import { contentHash } from "classformat/src/index.ts";
import { isClassId } from "../../core/sync/answers.ts";
import { readCapped } from "../capped-read.ts";

export interface StoredSync {
  readonly account: string | null;
  readonly cursor: number;
  /** Class id to content hash. */
  readonly held: ReadonlyMap<string, string>;
  /** A wipe is unfinished, or the cache is not one account's: it must be wiped before use. */
  readonly wipePending: boolean;
}

export interface CachedClass {
  readonly account: string;
  readonly hash: string;
  readonly document: Readonly<Record<string, unknown>>;
}

export interface ClassCache {
  load(): StoredSync;
  /** Throws when the class could not be kept, or while a wipe is unfinished. */
  keep(account: string, id: string, hash: string, document: Readonly<Record<string, unknown>>): void;
  /** Throws when one of them could not be deleted. */
  remove(ids: readonly string[]): void;
  /** Throws when the cursor could not be kept, or while a wipe is unfinished. */
  commit(account: string, cursor: number): void;
  /** The document, only when it still has the hash it was kept with; null otherwise. */
  read(id: string): CachedClass | null;
  /** Deletes every class and the cursor. Throws when anything is left; the marker then stays. */
  wipe(): void;
}

export const SYNC_FILE = "sync.json";
export const CLASSES_DIR = "classes";
export const WIPE_FILE = "wipe.pending";
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

/**
 * `account` is an opaque key (64 hex characters), never an address or a token. `remove` deletes a
 * path (`rmSync`; a test stands in a delete that fails, as a locked file does on Windows).
 */
export function classCache(dir: string, remove: (path: string, options?: RmOptions) => void = rmSync): ClassCache {
  const classes = join(dir, CLASSES_DIR);
  const marker = join(dir, WIPE_FILE);
  const unfinished = (): boolean => existsSync(marker);
  const classFile = (id: string): string => {
    // The id names a file, so only the contract's own form is ever used in a path.
    if (!isClassId(id)) throw new Error("not a class id");
    return join(classes, `${id}.json`);
  };
  /** Both folders exist and are this user's only, also when an older run made them wider. */
  const tighten = (): void => {
    for (const d of [dir, classes]) if (existsSync(d)) chmodSync(d, 0o700);
  };
  const ensure = (): void => {
    if (unfinished()) throw new Error("a wipe is unfinished");
    mkdirSync(classes, { recursive: true, mode: 0o700 });
    tighten();
  };
  const entry = (id: string): CachedClass | null => {
    const raw = readJson(classFile(id), MAX_CACHED_FILE_BYTES);
    if (!isObject(raw) || raw.v !== 1 || typeof raw.account !== "string" || !KEY.test(raw.account) || typeof raw.hash !== "string" || !HASH.test(raw.hash) || !isObject(raw.document)) return null;
    return { account: raw.account, hash: raw.hash, document: raw.document };
  };

  return {
    load() {
      const none = { account: null, cursor: 0, held: new Map<string, string>() };
      if (unfinished()) return { ...none, wipePending: true };
      try {
        tighten();
      } catch {
        // Tried again before the next write, which then fails instead.
      }
      const meta = readJson(join(dir, SYNC_FILE), MAX_SYNC_FILE_BYTES);
      const ok = isObject(meta) && meta.v === 1 && typeof meta.account === "string" && KEY.test(meta.account) && Number.isSafeInteger(meta.cursor) && (meta.cursor as number) >= 0;
      const account = ok ? (meta.account as string) : null;
      const cursor = ok ? (meta.cursor as number) : 0;
      const held = new Map<string, string>();
      let foreign = false;
      let names: string[] = [];
      try {
        names = readdirSync(classes);
      } catch {
        // No folder yet: nothing is held.
      }
      for (const name of names) {
        const id = name.match(FILE)?.[1];
        const found = id === undefined ? null : entry(id);
        if (id !== undefined && found !== null) {
          if (found.account === account) held.set(id, found.hash);
          else foreign = true;
        }
        // A leftover temporary file or a class file that does not read back is dropped.
        else if (id !== undefined || name.endsWith(".json.tmp")) rmSync(join(classes, name), { force: true });
      }
      // Nothing of another account, or of no account on record, is ever loaded as this one's.
      if (foreign) return { ...none, wipePending: true };
      return account === null ? { ...none, wipePending: false } : { account, cursor, held, wipePending: false };
    },
    keep(account, id, hash, document) {
      if (!KEY.test(account) || !HASH.test(hash)) throw new Error("not a class to keep");
      const file = classFile(id);
      ensure();
      writeAtomic(file, JSON.stringify({ v: 1, account, hash, document }));
    },
    remove(ids) {
      for (const id of ids) remove(classFile(id), { force: true });
    },
    commit(account, cursor) {
      if (!KEY.test(account) || !Number.isSafeInteger(cursor) || cursor < 0) throw new Error("not a cursor");
      ensure();
      writeAtomic(join(dir, SYNC_FILE), JSON.stringify({ v: 1, account, cursor }));
    },
    read(id) {
      try {
        if (unfinished()) return null;
        const found = entry(id);
        return found !== null && contentHash(found.document) === found.hash ? found : null;
      } catch {
        return null;
      }
    },
    wipe() {
      // The marker is on disk before anything is deleted, so a wipe cut short is finished later.
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeAtomic(marker, JSON.stringify({ v: 1 }));
      for (const name of readdirSync(dir)) if (name !== WIPE_FILE) remove(join(dir, name), { recursive: true, force: true });
      if (readdirSync(dir).some((name) => name !== WIPE_FILE)) throw new Error("the cache is not wiped");
      remove(marker, { force: true });
      remove(dir, { recursive: true, force: true });
    },
  };
}
