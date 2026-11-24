// Where Swedebeat's secrets live on this computer (ADR 0013 section 1): the token and the account's
// cache key, each encrypted by safeStorage (the operating system's keychain) in a file only this
// user can read, and the account's mix folder `<app data>/mixes/<account key>/`. No plain-text
// fallback: without a keychain nothing is written. Nothing here logs, and no path is ever built
// from anything but a 64-hex account key.
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { keychainFile } from "../pairing/keychain.ts";
import type { SafeStorageLike, SecretStore } from "../pairing/keychain.ts";

/** The longest token kept; a longer answer from a source is refused, not cut. */
export const MAX_TOKEN_BYTES = 8192;
/** The cache key's file is written by the mix cache (ADR 0013 section 3); here it is only found and deleted. */
const MAX_KEY_BYTES = 1024;
const ACCOUNT = /^[0-9a-f]{64}$/;
const FILE = /^mix-(token|key)-([0-9a-f]{64})\.bin$/;

export interface MixVault {
  /** True only when a real keychain protects what is saved. */
  available(): boolean;
  loadToken(account: string): string | null;
  /** Throws when the token could not be kept. */
  saveToken(account: string, token: string): void;
  clearToken(account: string): void;
  hasKey(account: string): boolean;
  clearKey(account: string): void;
  removeFolder(account: string): void;
  /** Every account with a token, a key or a mix folder on this computer. */
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

export function keychainVault(safe: SafeStorageLike, dir: string, platform: string): MixVault {
  const tokenFile = (a: string): string => join(dir, `mix-token-${checked(a)}.bin`);
  const keyFile = (a: string): string => join(dir, `mix-key-${checked(a)}.bin`);
  const store = (a: string): SecretStore => keychainFile(safe, tokenFile(a), platform, MAX_TOKEN_BYTES);
  const mixes = join(dir, "mixes");
  return {
    available: () => keychainFile(safe, join(dir, "mix-probe.bin"), platform, MAX_KEY_BYTES).available(),
    loadToken: (a) => store(a).load(),
    saveToken: (a, token) => store(a).save(token),
    clearToken: (a) => store(a).clear(),
    hasKey: (a) => exists(keyFile(a)),
    clearKey(a) {
      rmSync(keyFile(a), { force: true });
      rmSync(`${keyFile(a)}.tmp`, { force: true });
    },
    removeFolder(a) {
      // A link planted in the folder's place is removed itself; its target is never followed.
      rmSync(join(mixes, checked(a)), { recursive: true, force: true });
    },
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
