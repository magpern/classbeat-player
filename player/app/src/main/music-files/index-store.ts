// Where the local music file index is kept (ADR 0017 section 2): one file per account in its own
// folder of the app data folder, beside the class cache, and wiped with it. Only this user may
// read the folder (0o700) and the file (0o600). It is read without following a symbolic link and
// never past a cap, and written whole or not at all. Nothing here logs, and no error leaves it
// with a path: a fault reads as an empty index or reports false.
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_INDEX, parseIndex, serializeIndex } from "../../core/music-files/index-model.ts";
import type { MusicIndex } from "../../core/music-files/index-model.ts";
import { readCapped } from "../capped-read.ts";

export const INDEX_DIR = "music-index";
/** Well above 20 000 entries of long paths. */
export const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const KEY = /^[0-9a-f]{64}$/;

export interface IndexStore {
  /** The account's index; empty when there is none or it cannot be read. */
  load(account: string): MusicIndex;
  /** Keeps the account's index; false when it could not be written. */
  save(account: string, index: MusicIndex): boolean;
  /** Deletes every account's index; false when something could not be deleted. */
  wipe(): boolean;
}

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

export function indexStore(dir: string): IndexStore {
  const fileOf = (account: string): string => {
    // The key names a file, so only its own form is ever used in a path.
    if (!KEY.test(account)) throw new Error("not an account key");
    return join(dir, `${account}.json`);
  };
  return {
    load(account) {
      try {
        const file = fileOf(account);
        if (!existsSync(file)) return EMPTY_INDEX;
        const bytes = readCapped(file, MAX_INDEX_BYTES);
        return bytes === null ? EMPTY_INDEX : parseIndex(JSON.parse(bytes.toString("utf8")), account);
      } catch {
        return EMPTY_INDEX;
      }
    },
    save(account, index) {
      try {
        const file = fileOf(account);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        // Also when an older run made the folder wider.
        chmodSync(dir, 0o700);
        writeAtomic(file, serializeIndex(index, account));
        return true;
      } catch {
        return false;
      }
    },
    wipe() {
      try {
        rmSync(dir, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    },
  };
}
