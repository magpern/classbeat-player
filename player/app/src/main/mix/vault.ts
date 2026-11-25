// Where Swedebeat's secrets live on this computer (ADR 0013 section 1): the token and the account's
// cache key, each encrypted by safeStorage (the operating system's keychain) in a file only this
// user can read, and the account's mix folder `<app data>/mixes/<account key>/`. No plain-text
// fallback: without a keychain no secret is written. An empty "ending" mark, written before an
// account's deletion starts and removed once it is done, makes the account's token count as gone,
// so a crash between the steps never leaves an account that looks connected (issue #709). The mark
// and its folder are flushed to disk before `markEnding` returns, so a power loss after the key's
// deletion still finds the mark (#720); a mark made but not flushed is removed again, and that
// removal flushed (#729, #733). Nothing here logs, and no path is ever built from anything but a
// 64-hex account key.
import { randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, openSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { keychainFile } from "../pairing/keychain.ts";
import type { SafeStorageLike, SecretStore } from "../pairing/keychain.ts";

/** The longest token kept; a longer answer from a source is refused, not cut. */
export const MAX_TOKEN_BYTES = 8192;
/** The cache key is kept as 64 hex digits (256 bits, ADR 0013 section 3). */
const MAX_KEY_BYTES = 1024;
const KEY_HEX = /^[0-9a-f]{64}$/;
const ACCOUNT = /^[0-9a-f]{64}$/;
const FILE = /^mix-(token|key|ending)-([0-9a-f]{64})\.bin$/;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export interface MixVault {
  /** True only when a real keychain protects what is saved. */
  available(): boolean;
  /** Null when there is none, it cannot be read, or the account is ending. */
  loadToken(account: string): string | null;
  /** Throws when the token could not be kept. */
  saveToken(account: string, token: string): void;
  clearToken(account: string): void;
  hasKey(account: string): boolean;
  /** The account's cache key, or null when there is none or it cannot be read. */
  loadKey(account: string): Buffer | null;
  /** The account's cache key, made and kept on first use. Throws when it could not be kept. */
  createKey(account: string): Buffer;
  clearKey(account: string): void;
  removeFolder(account: string): void;
  /** Marks the account as ending, before its deletion starts. Throws when the mark could not be made. */
  markEnding(account: string): void;
  /** Whether the account's deletion was started and has not finished. */
  isEnding(account: string): boolean;
  /** Removes the mark, once every step of the deletion is done. */
  clearEnding(account: string): void;
  /** Every account with a token, a key, an ending mark or a mix folder on this computer. */
  accounts(): string[];
}

const checked = (account: string): string => {
  if (!ACCOUNT.test(account)) throw new Error("not an account key");
  return account;
};

const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const names = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** Flushes an open file or folder to disk (`fsyncSync`; a test stands in one that records or fails). */
export type Flush = (fd: number) => void;

/** Opens `path`, flushes it and closes it; throws when it cannot be opened or flushed. */
const flushPath = (path: string, flags: number, flush: Flush, mode?: number): void => {
  const fd = openSync(path, flags, mode);
  try {
    flush(fd);
  } finally {
    closeSync(fd);
  }
};

export function keychainVault(safe: SafeStorageLike, dir: string, platform: string, flush: Flush = fsyncSync): MixVault {
  const tokenFile = (a: string): string => join(dir, `mix-token-${checked(a)}.bin`);
  const keyFile = (a: string): string => join(dir, `mix-key-${checked(a)}.bin`);
  const endFile = (a: string): string => join(dir, `mix-ending-${checked(a)}.bin`);
  const store = (a: string): SecretStore => keychainFile(safe, tokenFile(a), platform, MAX_TOKEN_BYTES);
  const keyStore = (a: string): SecretStore => keychainFile(safe, keyFile(a), platform, MAX_KEY_BYTES);
  const loadKey = (a: string): Buffer | null => {
    const hex = keyStore(a).load();
    return hex !== null && KEY_HEX.test(hex) ? Buffer.from(hex, "hex") : null;
  };
  const mixes = join(dir, "mixes");
  return {
    available: () => keychainFile(safe, join(dir, "mix-probe.bin"), platform, MAX_KEY_BYTES).available(),
    loadToken: (a) => (exists(endFile(a)) ? null : store(a).load()),
    saveToken: (a, token) => store(a).save(token),
    clearToken: (a) => store(a).clear(),
    hasKey: (a) => exists(keyFile(a)),
    loadKey,
    createKey(a) {
      const kept = loadKey(a);
      if (kept !== null) return kept;
      const key = randomBytes(32);
      keyStore(a).save(key.toString("hex"));
      return key;
    },
    clearKey(a) {
      rmSync(keyFile(a), { force: true });
      rmSync(`${keyFile(a)}.tmp`, { force: true });
    },
    removeFolder(a) {
      // A link planted in the folder's place is removed itself; its target is never followed.
      rmSync(join(mixes, checked(a)), { recursive: true, force: true });
    },
    markEnding(a) {
      const file = endFile(a);
      const had = exists(file);
      try {
        // Empty, never truncating or following a link planted in its place; one already there is kept.
        flushPath(file, constants.O_WRONLY | constants.O_CREAT | NOFOLLOW, flush, 0o600);
        // The folder's entry for the mark too. Windows cannot open a folder to flush it; there NTFS
        // journals the new entry itself.
        if (platform !== "win32") flushPath(dir, constants.O_RDONLY, flush);
      } catch (e) {
        // Nothing is deleted after a failed mark, so a mark made here goes again: otherwise the
        // account would still be signed in while its token reads as gone, and a restart's sweep
        // would finish the deletion without dropping the token at Swedebeat (#729). A mark from an
        // earlier, unfinished deletion stays. The removal is flushed too, so a power loss right after
        // cannot bring the mark back (#733); when that flush fails as well, the first error is the
        // one reported.
        if (!had) {
          rmSync(file, { force: true });
          if (platform !== "win32") {
            try {
              flushPath(dir, constants.O_RDONLY, flush);
            } catch {
              // The original error below says why the sign-out failed.
            }
          }
        }
        throw e;
      }
    },
    isEnding: (a) => exists(endFile(a)),
    clearEnding: (a) => rmSync(endFile(a), { force: true }),
    accounts() {
      const found = new Set<string>();
      for (const n of names(dir)) {
        const m = n.replace(/\.tmp$/, "").match(FILE);
        if (m?.[2] !== undefined) found.add(m[2]);
      }
      for (const n of names(mixes)) if (ACCOUNT.test(n)) found.add(n);
      return [...found].sort();
    },
  };
}
