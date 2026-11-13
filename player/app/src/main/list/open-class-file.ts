// "Open a class file" (docs/design/class-list.md): the operating system's file dialog, then the
// file read as a class. A file that reads goes to the presenter as a snapshot that is not in the
// list, not cached and not pinned. A file that does not read changes nothing but the message: on
// the list it is the plate under the status, on the presenter page it is the presenter's error.
import type { Snapshot } from "../../core/snapshot.ts";
import type { FileErrorView } from "../../core/list/view.ts";
import type { Picked } from "../open-file.ts";

export interface OpenDeps {
  readonly pick: () => Promise<Picked>;
  readonly open: (name: string, text: string) => Snapshot;
  readonly refuse: (message: string) => Snapshot;
  /** The list page's way to show a failure; the presenter page uses `refuse`. */
  readonly fileFailed: (error: FileErrorView) => void;
  readonly dismiss: () => void;
  /** A file replaced the class being played: its pin and snapshot end. */
  readonly release: () => void;
  readonly showPresenter: () => void;
  readonly onList: () => boolean;
}

export async function openClassFile(d: OpenDeps): Promise<void> {
  const picked = await d.pick();
  if (picked === null) return;
  if ("error" in picked) {
    if (d.onList()) d.fileFailed({ message: picked.error, fileName: picked.name, details: [] });
    else d.refuse(picked.error);
    return;
  }
  const snapshot = d.open(picked.name, picked.text);
  if (snapshot.error !== null && d.onList()) {
    d.fileFailed({ message: snapshot.error.message, fileName: picked.name, details: snapshot.error.details.slice(0, 5) });
    return;
  }
  d.dismiss();
  if (snapshot.error === null) {
    d.release();
    d.showPresenter();
  }
}
