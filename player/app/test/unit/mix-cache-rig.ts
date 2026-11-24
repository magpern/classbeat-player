// A mix cache on a temporary folder for tests: the real keychain vault over a fake safeStorage, the
// fake source serving random bytes from memory, and a fake clock. Helpers reach the files on disk
// so tests can tear, tamper with and snapshot them. No network, no real account.
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHUNK_BYTES, mixTag } from "../../src/core/mix/cache-crypto.ts";
import { parseHeader } from "../../src/core/mix/cache-header.ts";
import type { MixHeader } from "../../src/core/mix/cache-header.ts";
import { createMixCache } from "../../src/main/mix/mix-cache.ts";
import type { MixCache, MixCacheDeps } from "../../src/main/mix/mix-cache.ts";
import { keychainVault } from "../../src/main/mix/vault.ts";
import type { MixVault } from "../../src/main/mix/vault.ts";
import { FAKE_TOKEN, FakeMixSource } from "./fake-mix-source.ts";
import { ACCT, fakeSafe } from "./mix-fakes.ts";

/** Two whole chunks and a short last one. */
export const MIX_BYTES = 2 * CHUNK_BYTES + 1000;

export interface Rig {
  readonly root: string;
  readonly vault: MixVault;
  readonly source: FakeMixSource;
  readonly clock: { now: number };
  readonly invalid: string[];
  cache: MixCache;
  /** Rebuilds the cache with other settings, keeping the folder, vault, source and clock. */
  rebuild(over?: Partial<MixCacheDeps>): void;
  tagOf(mixId: string, account?: string): string;
  hdrPath(mixId: string, account?: string): string;
  mixPath(mixId: string, account?: string): string;
  header(mixId: string, account?: string): MixHeader | null;
  /** The whole plaintext through a reader, or null when any chunk is not ok. */
  readAll(mixId: string, account?: string): Promise<Buffer | null>;
  done(): void;
}

export function makeRig(bytes: Uint8Array = randomBytes(MIX_BYTES), over: Partial<MixCacheDeps> = {}): Rig {
  const root = mkdtempSync(join(tmpdir(), "cbp-mixcache-"));
  const vault = keychainVault(fakeSafe(), root, "linux");
  vault.saveToken(ACCT, FAKE_TOKEN);
  const source = new FakeMixSource(bytes);
  source.chunkSize = 64 * 1024;
  const clock = { now: 1_000_000_000_000 };
  const invalid: string[] = [];
  const build = (o: Partial<MixCacheDeps>): MixCache =>
    createMixCache({ source, vault, root, now: () => clock.now, onTokenInvalid: (a) => invalid.push(a), ...o });
  const tagOf = (mixId: string, account = ACCT): string => {
    const key = vault.loadKey(account);
    if (key === null) throw new Error("no key yet");
    return mixTag(key, mixId).toString("hex");
  };
  const rig: Rig = {
    root,
    vault,
    source,
    clock,
    invalid,
    cache: build(over),
    rebuild(o = {}) {
      rig.cache = build({ ...over, ...o });
    },
    tagOf,
    hdrPath: (m, a = ACCT) => join(root, "mixes", a, `${tagOf(m, a)}.hdr`),
    mixPath: (m, a = ACCT) => join(root, "mixes", a, `${tagOf(m, a)}.mix`),
    header(m, a = ACCT) {
      const p = rig.hdrPath(m, a);
      return existsSync(p) ? (parseHeader(readFileSync(p))?.header ?? null) : null;
    },
    async readAll(m, a = ACCT) {
      const r = rig.cache.open(a, m);
      if (r === null) return null;
      const parts: Buffer[] = [];
      for (let i = 0; i < r.chunks; i++) {
        const c = await r.readChunk(i);
        if (!c.ok) return null;
        parts.push(c.plain);
      }
      return Buffer.concat(parts);
    },
    done: () => rmSync(root, { recursive: true, force: true }),
  };
  return rig;
}
