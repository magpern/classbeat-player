// What the class list window gets, and what Start does. The rows come from class sync's `list()`,
// read again only after sync says something the list shows has changed (never on each paint). The
// snapshot of the class being played is kept here, in memory only, so that a class whose cached
// copy is removed under it stays on the list until it ends. Nothing here logs, and nothing but
// the fields of `ListView` goes to the window.
import type { Snapshot } from "../../core/snapshot.ts";
import { listRows, snapshotOf } from "../../core/list/rows.ts";
import type { RowSnapshot } from "../../core/list/rows.ts";
import type { ClassRow } from "../../core/sync/class-list.ts";
import type { FileErrorView, ListView } from "../../core/list/view.ts";
import type { PairingService } from "../pairing/service.ts";
import type { SyncService } from "../sync/service.ts";

export interface ListDeps {
  readonly sync: Pick<SyncService, "view" | "list" | "pin" | "unpin" | "watch">;
  readonly pairing: Pick<PairingService, "view">;
  /** The key of the account the pairing's token reads (not the email), or null when not paired. */
  readonly account: () => string | null;
  /** Opens a class's document for play (the clock's own open); the snapshot carries the error, if any. */
  readonly open: (name: string, text: string) => Snapshot;
}

export interface ListController {
  view(): ListView;
  /** Pins the class as the instructor saw it and opens it; false (nothing started, list refreshed) when refused. */
  start(id: string, hash: string): boolean;
  /** A class file did not open: the list shows it, and stays as it was. */
  fileFailed(error: FileErrorView): void;
  dismissFileError(): void;
  /** The class being played has ended, or a class file replaced it: unpins it and drops its snapshot. */
  release(): void;
}

export function createListController(d: ListDeps): ListController {
  let fresh = false;
  let cached: readonly ClassRow[] = [];
  let snapshot: RowSnapshot | null = null;
  let fileError: FileErrorView | null = null;
  let who = "";
  const stale = (): void => {
    fresh = false;
  };
  d.sync.watch(stale);

  return {
    view() {
      const sync = d.sync.view();
      const pairing = d.pairing.view();
      // Another pairing or account, another list: read it again. The key is the account's, not the
      // email's: a new account with the same email is another account.
      const key = d.account();
      const account = pairing.state === "paired" ? `paired:${key ?? ""}:${pairing.email}` : pairing.state;
      if (account !== who) {
        who = account;
        stale();
        // The snapshot is the account's it was taken under: never shown under another pairing.
        snapshot = null;
      }
      // It lives only while the class is being played, and not while the cache is being wiped.
      if (sync.pinned === null || sync.wiping) snapshot = null;
      if (!fresh) {
        cached = d.sync.list();
        fresh = true;
      }
      return { sync, pairing, rows: listRows(cached, sync.pinned, snapshot), fileError };
    },
    start(id, hash) {
      // One class at a time: the shell refuses, whatever the page shows.
      if (d.sync.view().pinned !== null) return false;
      // Only a row the instructor was shown; the pin then checks that it is still that version.
      const row = cached.find((r) => r.id === id && r.hash === hash);
      const document = row === undefined ? null : d.sync.pin(id, hash);
      if (row === undefined || document === null) {
        stale();
        return false;
      }
      const opened = d.open(row.title, JSON.stringify(document));
      if (opened.error !== null || opened.doc === null) {
        d.sync.unpin();
        stale();
        return false;
      }
      snapshot = snapshotOf(row);
      fileError = null;
      return true;
    },
    fileFailed(error) {
      fileError = error;
    },
    dismissFileError() {
      fileError = null;
    },
    release() {
      snapshot = null;
      d.sync.unpin();
      stale();
    },
  };
}
