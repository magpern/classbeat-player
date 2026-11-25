// Fakes for the Swedebeat sign-in tests: a vault that keeps everything in memory and records every
// step in order, and a safeStorage that encrypts well enough to show plain text never reaches a disk.
import type { MixVault } from "../../src/main/mix/vault.ts";
import type { SafeStorageLike } from "../../src/main/pairing/keychain.ts";

export const ACCT = "a".repeat(64);
export const OTHER = "b".repeat(64);

export interface FakeVault extends MixVault {
  readonly log: string[];
  readonly tokens: Map<string, string>;
  readonly keys: Set<string>;
  readonly folders: Set<string>;
  /** Accounts marked as ending: their token counts as gone, as in the real vault. */
  readonly ending: Set<string>;
  usable: boolean;
  failSave: boolean;
  /** A step that throws, to show the next one still runs. */
  failStep: string | null;
}

export function fakeVault(): FakeVault {
  const v: FakeVault = {
    log: [],
    tokens: new Map(),
    keys: new Set(),
    folders: new Set(),
    ending: new Set(),
    usable: true,
    failSave: false,
    failStep: null,
    available: () => v.usable,
    loadToken: (a) => (v.ending.has(a) ? null : (v.tokens.get(a) ?? null)),
    saveToken(a, t) {
      if (v.failSave) throw new Error("record not saved");
      v.log.push(`saveToken ${a.slice(0, 1)}`);
      v.tokens.set(a, t);
    },
    clearToken(a) {
      v.log.push(`clearToken ${a.slice(0, 1)}`);
      if (v.failStep === "clearToken") throw new Error("x");
      v.tokens.delete(a);
    },
    hasKey: (a) => v.keys.has(a),
    loadKey: (a) => (v.keys.has(a) ? Buffer.alloc(32, a.charCodeAt(0)) : null),
    createKey(a) {
      v.keys.add(a);
      return Buffer.alloc(32, a.charCodeAt(0));
    },
    clearKey(a) {
      v.log.push(`clearKey ${a.slice(0, 1)}`);
      if (v.failStep === "clearKey") throw new Error("x");
      v.keys.delete(a);
    },
    removeFolder(a) {
      v.log.push(`removeFolder ${a.slice(0, 1)}`);
      if (v.failStep === "removeFolder") throw new Error("x");
      v.folders.delete(a);
    },
    markEnding(a) {
      v.log.push(`markEnding ${a.slice(0, 1)}`);
      if (v.failStep === "markEnding") throw new Error("x");
      v.ending.add(a);
    },
    isEnding: (a) => v.ending.has(a),
    clearEnding(a) {
      v.log.push(`clearEnding ${a.slice(0, 1)}`);
      if (v.failStep === "clearEnding") throw new Error("x");
      v.ending.delete(a);
    },
    accounts: () => [...new Set([...v.tokens.keys(), ...v.keys, ...v.folders, ...v.ending])].sort(),
  };
  return v;
}

/** Encrypts by reversing and XOR-ing. */
export function fakeSafe(available = true, backend = "gnome_libsecret"): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (t) => Buffer.from(Buffer.from(t, "utf8").map((b) => b ^ 0x5a)).reverse(),
    decryptString: (d) => Buffer.from(Buffer.from(d).reverse().map((b) => b ^ 0x5a)).toString("utf8"),
  };
}
