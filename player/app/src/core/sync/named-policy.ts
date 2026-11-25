// Which mixes the account's synced classes name, for the mix cache to delete the others (ADR 0013
// section 3). Pure. An answer is given only while the synced list is complete and authoritative:
// the last sync finished, no sync runs, the cache was read, no wipe waits, the pairing is the cached
// account's and every held class reads back. Each of those guards stands alone, so none leans on
// another (issue #720). A complete list with no class at all names no mix: the empty answer lets
// every unnamed mix go. A list whose classes name no mix stays null, as before: deleting every mix
// is not done on the strength of classes that name none.
import { mixesNamed } from "../mix/keep-policy.ts";
import type { SyncState } from "./sync-model.ts";

/** The mix ids every class of the account names (ADR 0013 section 3: a mix no class names goes). */
export interface NamedMixes {
  readonly account: string;
  readonly mixes: readonly string[];
}

export type NamedState = Pick<SyncState, "account" | "status" | "run" | "unread" | "lasting" | "wipePending" | "wipeAfterPin" | "held">;

/**
 * `paired` is the account the pairing reads, or null when not paired. `docs` reads the held classes
 * that read back with their hash (only called once every other guard passed).
 */
export function namedMixes(s: NamedState, paired: string | null, docs: () => ReadonlyMap<string, Readonly<Record<string, unknown>>>): NamedMixes | null {
  const account = s.account;
  if (account === null || paired !== account) return null;
  if (s.status !== "synced" || s.run !== null || s.unread || s.lasting) return null;
  if (s.wipePending || s.wipeAfterPin) return null;
  const read = docs();
  // A held class that does not read back may still name a mix: the list is not complete.
  if (read.size !== s.held.size) return null;
  if (s.held.size === 0) return { account, mixes: [] };
  const mixes = mixesNamed(read.values());
  return mixes.length === 0 ? null : { account, mixes };
}
