// The download of the open class's mix (ADR 0013 section 3): started when the class opens on a
// signed-in account, read for its progress once a second, and started again while it has not
// completed for a reason that can pass (a lost connection, a sign-out, the source away), every
// RETRY_MS. A refusal that will not change (not found, not allowed, too large, bad) is final. The
// cache runs one download at a time per account; a resumed download keeps the chunks it has.
import type { ClassMix } from "../../core/mix/class-mix.ts";
import type { MixReadiness } from "../../core/mix/mode-policy.ts";
import type { MixView } from "../../core/mix/view.ts";
import type { CacheOutcome, MixCache } from "./mix-cache.ts";

export interface OpenDownloadDeps {
  readonly cache: Pick<MixCache, "download" | "open">;
  readonly view: () => MixView;
  /** The paired account's key, or null. */
  readonly account: () => string | null;
  /** What eviction keeps while this mix downloads (core/mix/keep-policy.ts). */
  readonly keep: (mixId: string) => readonly string[];
  /** Monotonic ms. */
  readonly now: () => number;
}

export interface OpenDownload {
  readonly mix: ClassMix;
  /** The account the download runs for, once it has started. */
  account(): string | null;
  /** Starts or restarts the download when it is due, and reads its progress at most once a second. */
  tick(): void;
  readiness(): MixReadiness;
  complete(): boolean;
  percent(): number;
}

/** How often the download's progress and completeness are read. */
export const POLL_MS = 1000;
/** A download that ended for a reason that can pass is started again after this long. */
export const RETRY_MS = 30_000;

const RETRIED: readonly CacheOutcome[] = ["interrupted", "unavailable", "token_invalid", "signed_out", "no_key"];
const NOT_CHECKED: readonly CacheOutcome[] = ["bad", "not_found", "too_large"];

export function openDownload(d: OpenDownloadDeps, mix: ClassMix): OpenDownload {
  let account: string | null = null;
  let downloading = false;
  let outcome: CacheOutcome | null = null;
  let settledAt = -Infinity;
  let complete = false;
  let percent = 0;
  let polledAt = -Infinity;

  const due = (t: number): boolean => outcome === null || (RETRIED.includes(outcome) && t - settledAt >= RETRY_MS);
  const start = (t: number): void => {
    const a = d.account();
    if (downloading || complete || !due(t) || a === null || d.view().state !== "signed_in") return;
    account = a;
    downloading = true;
    const settle = (o: CacheOutcome): void => {
      downloading = false;
      outcome = o;
      settledAt = d.now();
      polledAt = -Infinity;
    };
    void d.cache.download(a, mix.id, d.keep(mix.id)).then(settle, () => settle("unavailable"));
  };
  const poll = (t: number): void => {
    if (account === null || t - polledAt < POLL_MS) return;
    polledAt = t;
    const reader = d.cache.open(account, mix.id);
    if (reader === null) return;
    complete = reader.complete;
    if (reader.complete) percent = 100;
    else void reader.written().then((n) => (percent = reader.chunks > 0 ? (100 * n) / reader.chunks : 0), () => undefined);
  };

  return {
    mix,
    account: () => account,
    tick() {
      const t = d.now();
      start(t);
      poll(t);
    },
    readiness() {
      if (complete || outcome === "complete") return "ready";
      if (outcome === "not_allowed") return "not_allowed";
      if (outcome !== null && NOT_CHECKED.includes(outcome)) return "not_checked";
      // A download still running is streamed: the scheme waits up to 10 s for each chunk.
      return downloading ? "streaming" : "downloading";
    },
    complete: () => complete,
    percent: () => percent,
  };
}
