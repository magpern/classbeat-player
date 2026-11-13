// What the shell sends the class list window: built field by field, so no token, no document and
// no account key can ride along. Pure types.
import type { PairingView } from "../pairing/view.ts";
import type { SyncView } from "../sync/view.ts";
import type { ListRow } from "./rows.ts";

/** A class file that did not open: the message, the file's name, up to five detail lines. */
export interface FileErrorView {
  readonly message: string;
  readonly fileName: string;
  readonly details: readonly string[];
}

export interface ListView {
  readonly sync: SyncView;
  readonly pairing: PairingView;
  readonly rows: readonly ListRow[];
  readonly fileError: FileErrorView | null;
}

/** What the window holds itself: the filter text and the selection. */
export interface ListUi {
  readonly filter: string;
  readonly selectedId: string | null;
  readonly lastStartedId: string | null;
}
