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
    usable: true,
    failSave: false,
    failStep: null,
    available: () => v.usable,
    loadToken: (a) => v.tokens.get(a) ?? null,
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
    accounts: () => [...new Set([...v.tokens.keys(), ...v.keys, ...v.folders])].sort(),
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
