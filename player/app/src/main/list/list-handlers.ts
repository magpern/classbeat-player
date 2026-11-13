// The class list window's IPC handlers. Only the class list page may use them (the sender check
// comes first, before anything is parsed); a refused message gets null and changes nothing.
import { CH_LIST_BACK, CH_LIST_DISMISS, CH_LIST_OPEN_FILE, CH_LIST_START, CH_LIST_VIEW } from "../../core/channels.ts";
import { parseStartRequest } from "../../core/list/commands.ts";
import type { Trusted } from "../../core/ipc-policy.ts";
import type { IpcBus } from "../ipc-handlers.ts";
import { pageEvent } from "../ipc-handlers.ts";
import type { ListController } from "./list-controller.ts";

export interface ListHost {
  /** The presenter page takes the window's place; the room screen does not open yet (no window for it exists). */
  readonly showPresenter: () => void;
  readonly openFile: () => Promise<void>;
}

export function registerListHandlers(bus: IpcBus, trusted: () => Trusted, list: ListController, host: ListHost): void {
  const onList = (e: Parameters<typeof pageEvent>[0]): boolean => pageEvent(e, trusted) === "list";
  bus.handle(CH_LIST_VIEW, (e) => (onList(e) ? list.view() : null));
  bus.handle(CH_LIST_START, (e, raw) => {
    if (!onList(e)) return null;
    const req = parseStartRequest(raw);
    // A refused or malformed start opens nothing; the answer is the list as it is now.
    if (req !== null && list.start(req.id, req.hash)) host.showPresenter();
    return list.view();
  });
  bus.handle(CH_LIST_OPEN_FILE, async (e) => {
    if (!onList(e)) return null;
    await host.openFile();
    return list.view();
  });
  bus.handle(CH_LIST_DISMISS, (e) => {
    if (!onList(e)) return null;
    list.dismissFileError();
    return list.view();
  });
  // "Back to the class": only while a class is pinned.
  bus.handle(CH_LIST_BACK, (e) => {
    if (!onList(e)) return null;
    if (list.view().sync.pinned !== null) host.showPresenter();
    return list.view();
  });
}
