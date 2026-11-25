// Downloads ahead (ADR 0013 section 3): when the account's classes sync, and when the account signs
// in to Swedebeat, every mix a synced class names is downloaded, one after another, so a class
// opened later finds its mix ready. Only one download of ours waits in the account's queue at a
// time, so the open class's own download (main/mix/open-download.ts) is never far behind. A
// download ahead never takes the cache past its cap: a mix that does not fit whole is skipped until
// the next sync. A mix whose download did not complete is asked again at the next sync or sign-in;
// one that completed or was refused for good is not. At each sync, once the synced list is
// complete, the mixes no class names any more are deleted; the open class's mix never is.
import type { MixView } from "../../core/mix/view.ts";
import type { NamedMixes } from "../sync/service.ts";
import type { CacheOutcome, MixCache } from "./mix-cache.ts";

export interface PrefetchDeps {
  readonly cache: Pick<MixCache, "download" | "evict">;
  readonly view: () => MixView;
  /** The paired account's key, or null. */
  readonly account: () => string | null;
  /** The mix ids the account's synced classes name (SyncService `mixes`). */
  readonly listed: () => readonly string[];
  /** The same with their account, only while that list is complete (SyncService `named`); else null. */
  readonly named: () => NamedMixes | null;
  /** The open class's mix (MixPlayer `openMix`), or null. */
  readonly open: () => string | null;
}

export interface Prefetch {
  /** The classes synced: delete the mixes no class names, then download what is not yet asked. */
  synced(): void;
  /** Cheap, for every snapshot: acts only when the account or its sign-in changed. */
  check(): void;
}

/** Outcomes asked again later: the reason can pass. */
const AGAIN: readonly CacheOutcome[] = ["interrupted", "unavailable", "token_invalid", "signed_out", "no_key"];

export function createPrefetch(d: PrefetchDeps): Prefetch {
  let asked = new Set<string>();
  // Mixes that did not fit in this round: asked again at the next sync.
  let skipped = new Set<string>();
  let askedFor: string | null = null;
  let busy = false;
  let seen = "";
  const pinned = (): readonly string[] => {
    const o = d.open();
    return o === null ? [] : [o];
  };

  const next = (): void => {
    const a = d.account();
    if (busy || a === null || d.view().state !== "signed_in") return;
    if (a !== askedFor) {
      asked = new Set();
      skipped = new Set();
      askedFor = a;
    }
    const listed = d.listed();
    const mix = listed.find((m) => !asked.has(m) && !skipped.has(m));
    if (mix === undefined) return;
    asked.add(mix);
    busy = true;
    const settle = (o: CacheOutcome): void => {
      busy = false;
      if (a === askedFor && (AGAIN.includes(o) || o === "no_room")) asked.delete(mix);
      if (a === askedFor && o === "no_room") skipped.add(mix);
      // A lost connection or a sign-out would fail the rest too: they wait for the next sync.
      if (!AGAIN.includes(o)) next();
    };
    void d.cache.download(a, mix, { keep: listed, pinned: pinned(), fit: true }).then(settle, () => settle("unavailable"));
  };

  const sweep = (): void => {
    const a = d.account();
    const n = d.named();
    if (a === null || n === null || n.account !== a) return;
    void d.cache.evict(a, { keep: n.mixes, pinned: pinned(), named: n.mixes }).catch(() => undefined);
  };

  return {
    synced() {
      skipped = new Set();
      sweep();
      next();
    },
    check() {
      const state = d.view().state;
      const now = `${d.account() ?? ""} ${state}`;
      if (now === seen) return;
      seen = now;
      // Signed out: what was asked is asked again after the next sign-in.
      if (state !== "signed_in") {
        asked = new Set();
        askedFor = null;
      }
      next();
    },
  };
}
