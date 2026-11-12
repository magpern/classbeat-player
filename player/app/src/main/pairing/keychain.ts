// Where the pairing record (core/pairing/record.ts) is kept: encrypted by Electron's safeStorage
// with the operating system's keychain, in one file in the app's own folder, readable by this user
// only. No plain-text fallback: without a keychain nothing is written and pairing is refused.
import { chmodSync, closeSync, constants, fstatSync, openSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keychainUsable } from "../../core/pairing/keychain-policy.ts";
import { MAX_RECORD_BYTES } from "../../core/pairing/record.ts";

export interface SecretStore {
  /** True only when a real keychain protects what is saved. */
  available(): boolean;
  /** The saved text, or null when there is none or it cannot be read. */
  load(): string | null;
  /** Throws when the text could not be kept. */
  save(text: string): void;
  clear(): void;
}

/** The part of Electron's safeStorage used here. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
}

export const RECORD_FILE = "device-pairing.bin";
/** The encrypted record is never larger than this; a bigger file is refused unread. */
export const MAX_FILE_BYTES = 4 * MAX_RECORD_BYTES;

/**
 * The file's bytes, or null when it is not a plain file or is over `max`. The size is checked
 * before anything is read, a symbolic link is not followed where the system can refuse one (not
 * Windows, where only this user can write the folder), and
 * never more than `max` bytes are read, even if the file grows meanwhile.
 */
function readCapped(file: string, max: number): Buffer | null {
  // O_NONBLOCK: a pipe planted in the file's place cannot hang the open; it is then not a file.
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > max) return null;
    const buf = Buffer.alloc(max + 1);
    let n = 0;
    for (let got = -1; got !== 0 && n <= max; n += got) got = readSync(fd, buf, n, buf.length - n, null);
    return n > max ? null : buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

export function keychainStore(safe: SafeStorageLike, dir: string, platform: string): SecretStore {
  const file = join(dir, RECORD_FILE);
  const available = (): boolean => {
    try {
      const backend = platform === "linux" ? (safe.getSelectedStorageBackend?.() ?? null) : null;
      return keychainUsable(platform, safe.isEncryptionAvailable(), backend);
    } catch {
      return false;
    }
  };
  return {
    available,
    load() {
      if (!available()) return null;
      try {
        const data = readCapped(file, MAX_FILE_BYTES);
        return data === null ? null : safe.decryptString(data);
      } catch {
        return null;
      }
    },
    save(text) {
      if (!available()) throw new Error("no keychain");
      if (Buffer.byteLength(text) > MAX_RECORD_BYTES) throw new Error("record too large");
      const tmp = `${file}.tmp`;
      // A stale temporary file, or a link planted in its place, is removed (the link itself, never
      // its target). The new one is then created exclusively, so if anything appears there in the
      // meantime the write fails instead of following it.
      rmSync(tmp, { force: true });
      try {
        writeFileSync(tmp, safe.encryptString(text), { mode: 0o600, flag: "wx" });
        chmodSync(tmp, 0o600);
        renameSync(tmp, file);
      } catch {
        rmSync(tmp, { force: true });
        throw new Error("record not saved");
      }
    },
    clear() {
      rmSync(file, { force: true });
      rmSync(`${file}.tmp`, { force: true });
    },
  };
}

/**
 * Development and tests only (never a packaged build): held in memory for this run, written
 * nowhere. Lets the e2e test pair against a fake backend on a machine with no keychain.
 */
export function memoryStore(): SecretStore {
  let text: string | null = null;
  return {
    available: () => true,
    load: () => text,
    save(t) {
      text = t;
    },
    clear() {
      text = null;
    },
  };
}
