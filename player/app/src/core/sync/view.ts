// What the window may know about class sync. Pure. No token, no document, no account key. While
// the status is "unavailable" the cache could not be read: its files are kept, none is shown.
import type { Status, SyncState } from "./sync-model.ts";

export interface SyncView {
  readonly status: Status;
  /** How many classes are cached. */
  readonly classes: number;
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
  return { status: s.status, classes: s.held.size, pinned: p === null ? null : { id: p.id, after } };
}
