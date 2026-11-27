// What the shell sends the class list window: built field by field, so no token, no document and
// no account key can ride along. Pure types.
import type { FilesView } from "../music-files/files-view.ts";
import type { FormNote } from "../mix/form-note.ts";
import type { MixUi } from "../mix/list-model.ts";
import type { MixView } from "../mix/view.ts";
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
  /** Swedebeat: a state and field names only (core/mix/view.ts). */
  readonly mix: MixView;
  /** The music files state of each local class (core/music-files/files-view.ts): no path, no folder, nothing from the disk. */
  readonly files: readonly FilesView[];
}

/** What the window holds itself: the filter text and the selection. */
export interface ListUi {
  readonly filter: string;
  readonly selectedId: string | null;
  readonly lastStartedId: string | null;
  /** The Swedebeat form or question the page has open, or the call it waits for; "none" when absent. */
  readonly mix?: MixUi;
  /** What the open Swedebeat form says when it stayed open without a refusal; null when nothing. */
  readonly mixNote?: FormNote | null;
  /** The class whose missing songs the page shows in place of the list, or null. */
  readonly filesOpen?: string | null;
}
