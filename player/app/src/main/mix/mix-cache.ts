// The encrypted mix cache in the main process (ADR 0013 section 3): one folder per classbeat-player
// account under `<app data>/mixes/`, one cache key per account kept only through the keychain
// (main/mix/vault.ts), downloads one at a time per account, readers that authenticate every chunk,
// and eviction by the pure policy (core/mix/eviction-policy.ts). The Swedebeat token is read from
// the vault here and passed only to the source; neither it nor a key is logged or returned.
import { mixTag } from "../../core/mix/cache-crypto.ts";
import { DEFAULT_CAP_BYTES, evictionPlan } from "../../core/mix/eviction-policy.ts";
import type { CachedMix } from "../../core/mix/eviction-policy.ts";
import { MIX_ID } from "../../core/mix/class-mix.ts";
import type { MixSource } from "../../core/mix/source.ts";
import { accountFolder, removeStray } from "./cache-files.ts";
import { loadHeader, saveHeader } from "./cache-entry.ts";
import type { AccountCache } from "./cache-entry.ts";
import { downloadMix } from "./mix-download.ts";
import type { DownloadOutcome } from "./mix-download.ts";
import { openReader } from "./mix-reader.ts";
import type { MixReader } from "./mix-reader.ts";
import type { MixVault } from "./vault.ts";

export interface MixCacheDeps {
  readonly source: MixSource;
  readonly vault: MixVault;
  /** The app's data folder; mixes go to `<root>/mixes/<account key>/`. */
  readonly root: string;
  readonly now: () => number;
  /** The size cap per account (a setting; 4 GiB by default). */
  readonly capBytes?: number;
  /** The source said the token is no longer valid (main/mix/service.ts `tokenInvalid`). */
  readonly onTokenInvalid?: (account: string) => void;
  readonly idleMs?: number;
}

export interface EvictOptions {
  /** Mix ids never deleted now: the one playing, those of classes starting within 24 hours. */
  readonly keep: readonly string[];
  /** Every mix id some class of the account names; when given, any other cached mix is deleted. */
  readonly named?: readonly string[];
}

export type CacheOutcome = DownloadOutcome | "signed_out" | "no_key";

export interface MixCache {
  /** Downloads the mix for the account, or resumes it; then evicts above the cap, keeping this mix and `keep`. */
  download(account: string, mixId: string, keep?: readonly string[]): Promise<CacheOutcome>;
  /** A reader for the account's cached mix, or null. Never while the account holds no token. */
  open(account: string, mixId: string): MixReader | null;
  /** The mix was played now: it moves to the back of the eviction order. */
  played(account: string, mixId: string): void;
  /** Deletes leftovers, then what the eviction policy chooses. Returns how many mixes went. */
  evict(account: string, opts: EvictOptions): Promise<number>;
  /**
   * Sign-out: stops the account's running download, drops the ones waiting, and resolves once none
   * is left, so its folder can be removed with nothing still writing to it.
   */
  cancel(account: string): Promise<void>;
}

const validId = (id: string): boolean => typeof id === "string" && MIX_ID.test(id);

export function createMixCache(d: MixCacheDeps): MixCache {
  const cap = d.capBytes ?? DEFAULT_CAP_BYTES;
  const queues = new Map<string, Promise<unknown>>();
  // One download or eviction at a time per account.
  const queued = <T>(account: string, job: () => Promise<T>): Promise<T> => {
    const run = (queues.get(account) ?? Promise.resolve()).then(job, job);
    const tail = run.catch(() => undefined);
    queues.set(account, tail);
    void tail.then(() => {
      if (queues.get(account) === tail) queues.delete(account);
    });
    return run;
  };
  // One abort per account for the jobs queued until the next cancel.
  const aborts = new Map<string, AbortController>();
  const abortOf = (account: string): AbortSignal => {
    let a = aborts.get(account);
    if (a === undefined) aborts.set(account, (a = new AbortController()));
    return a.signal;
  };
  const cacheOf = (account: string, create: boolean): AccountCache | null => {
    let key: Buffer | null;
    try {
      key = create ? d.vault.createKey(account) : d.vault.loadKey(account);
    } catch {
      return null;
    }
    return key === null ? null : { folder: accountFolder(d.root, account), cacheKey: key };
  };
  const tokenOf = (account: string): string | null => (d.vault.available() ? d.vault.loadToken(account) : null);

  async function evictNow(account: string, opts: EvictOptions): Promise<number> {
    const c = cacheOf(account, false);
    if (c === null) return 0;
    const { tags, strays } = c.folder.scan();
    for (const n of strays) removeStray(c.folder, n);
    const mixes: CachedMix[] = [];
    let gone = 0;
    for (const [tag, bytes] of tags) {
      const h = loadHeader(c, tag);
      if (h === null || h.state === "bad") {
        c.folder.remove(tag);
        gone++;
      } else mixes.push({ tag, bytes, usedAt: h.usedAt });
    }
    const tagsOf = (ids: readonly string[]): Set<string> => new Set(ids.filter(validId).map((id) => mixTag(c.cacheKey, id).toString("hex")));
    const plan = evictionPlan(mixes, { now: d.now(), capBytes: cap, keep: tagsOf(opts.keep), ...(opts.named === undefined ? {} : { named: tagsOf(opts.named) }) });
    for (const tag of plan) c.folder.remove(tag);
    return gone + plan.length;
  }

  return {
    download(account, mixId, keep = []) {
      const signal = abortOf(account);
      return queued(account, async (): Promise<CacheOutcome> => {
        if (signal.aborted) return "signed_out";
        if (!validId(mixId)) return "not_found";
        const token = tokenOf(account);
        if (token === null) return "signed_out";
        const c = cacheOf(account, true);
        if (c === null) return "no_key";
        const out = await downloadMix(c, { source: d.source, token, mixId, now: d.now(), capBytes: cap, signal, ...(d.idleMs === undefined ? {} : { idleMs: d.idleMs }) });
        if (out === "token_invalid") d.onTokenInvalid?.(account);
        if (out === "complete" && !signal.aborted) await evictNow(account, { keep: [...keep, mixId] });
        return out;
      });
    },
    open(account, mixId) {
      if (!validId(mixId) || tokenOf(account) === null) return null;
      const c = cacheOf(account, false);
      return c === null ? null : openReader(c, mixId);
    },
    played(account, mixId) {
      if (!validId(mixId)) return;
      const c = cacheOf(account, false);
      if (c === null) return;
      const tag = mixTag(c.cacheKey, mixId).toString("hex");
      const h = loadHeader(c, tag);
      if (h !== null && h.state !== "bad") saveHeader(c, { ...h, usedAt: d.now() });
    },
    evict(account, opts) {
      const signal = abortOf(account);
      return queued(account, async () => (signal.aborted ? 0 : evictNow(account, opts)));
    },
    async cancel(account) {
      aborts.get(account)?.abort();
      aborts.delete(account);
      await (queues.get(account) ?? Promise.resolve());
    },
  };
}
