// Downloads ahead (ADR 0013 section 3): when the account's classes sync, and when the account signs
// in to Swedebeat, every mix a synced class names is downloaded, one after another, so a class
// opened later finds its mix ready. Only one download of ours waits in the account's queue at a
// time, so the open class's own download (main/mix/open-download.ts) is never far behind. A mix
// whose download did not complete is asked again at the next sync or sign-in; one that completed
// or was refused for good is not. Eviction keeps every mix the synced classes name.
import { keepOf } from "../../core/mix/keep-policy.ts";
import type { MixView } from "../../core/mix/view.ts";
import type { CacheOutcome, MixCache } from "./mix-cache.ts";

export interface PrefetchDeps {
  readonly cache: Pick<MixCache, "download">;
  readonly view: () => MixView;
  /** The paired account's key, or null. */
  readonly account: () => string | null;
  /** The mix ids the account's synced classes name (SyncService `mixes`). */
  readonly listed: () => readonly string[];
}

export interface Prefetch {
  /** The classes synced: download what is not yet asked. */
  synced(): void;
  /** Cheap, for every snapshot: acts only when the account or its sign-in changed. */
  check(): void;
}

/** Outcomes asked again later: the reason can pass. */
const AGAIN: readonly CacheOutcome[] = ["interrupted", "unavailable", "token_invalid", "signed_out", "no_key"];

export function createPrefetch(d: PrefetchDeps): Prefetch {
  let asked = new Set<string>();
  let askedFor: string | null = null;
  let busy = false;
  let seen = "";

  const next = (): void => {
    const a = d.account();
    if (busy || a === null || d.view().state !== "signed_in") return;
    if (a !== askedFor) {
      asked = new Set();
      askedFor = a;
    }
    const listed = d.listed();
    const mix = listed.find((m) => !asked.has(m));
    if (mix === undefined) return;
    asked.add(mix);
    busy = true;
    const settle = (o: CacheOutcome): void => {
      busy = false;
      if (a === askedFor && AGAIN.includes(o)) asked.delete(mix);
      // A lost connection or a sign-out would fail the rest too: they wait for the next sync.
      if (!AGAIN.includes(o)) next();
    };
    void d.cache.download(a, mix, keepOf(null, listed)).then(settle, () => settle("unavailable"));
  };

  return {
    synced: next,
    check() {
      const now = `${d.account() ?? ""} ${d.view().state}`;
      if (now === seen) return;
      seen = now;
      next();
    },
  };
}
