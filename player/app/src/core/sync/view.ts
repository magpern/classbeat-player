// What the window may know about class sync. Pure. No token, no document, no account key. While
// the status is "unavailable" the cache could not be read: its files are kept, none is shown.
import type { Status, SyncState } from "./sync-model.ts";

export interface SyncView {
  readonly status: Status;
  /**
   * While the status is "unavailable": "lasting" when reading again will not help (a file where
   * the class folder should be, or a folder where a class file should be: the screen says what to
   * do), "passing" otherwise. Null at any other status.
   */
  readonly unavailable: "passing" | "lasting" | null;
  /** A wipe of the cache is under way, or waits for the class being played to end. */
  readonly wiping: boolean;
  /** How many classes are cached. */
  readonly classes: number;
  /** The classes whose newer version could not be fetched (and is skipped): the older copy stays. */
  readonly notUpdated: readonly string[];
  /**
   * The class being played, and whether sync has something newer for after it: a newer version,
   * or its removal (the cached copy is gone; the snapshot plays to the end).
   */
  readonly pinned: { readonly id: string; readonly after: "none" | "newer" | "removed" } | null;
}

export function syncView(s: SyncState): SyncView {
  const p = s.pinned;
  const now = p === null ? undefined : s.held.get(p.id);
  const after = now === undefined ? "removed" : now === p?.hash ? "none" : "newer";
  return {
    status: s.status,
    unavailable: s.status !== "unavailable" ? null : s.lasting ? "lasting" : "passing",
    wiping: s.wipePending,
    classes: s.held.size,
    // Only classes still held: a class skipped that was never cached has no row to tag.
    notUpdated: [...s.notUpdated].filter((id) => s.held.has(id)).sort(),
    pinned: p === null ? null : { id: p.id, after },
  };
}
