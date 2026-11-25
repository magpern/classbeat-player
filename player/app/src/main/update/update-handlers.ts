// The update bridge's channels (ADR 0014, section 5): the status, Check now, Open release page and
// the two switches. Only the class list page may use them, and the sender is checked before
// anything is read. A refused message gets null and changes nothing. The three calls without an
// argument refuse one that carries any; each setter takes exactly true or false. Nothing the page
// sends is ever an address, a path or the feed: there is no channel that takes one.
import { CH_UPDATE_CHECK, CH_UPDATE_OPEN_RELEASE, CH_UPDATE_SET_AUTO, CH_UPDATE_SET_PRERELEASES, CH_UPDATE_STATUS } from "../../core/channels.ts";
import { UPDATE_PAGE } from "../../core/ipc-policy.ts";
import type { Trusted } from "../../core/ipc-policy.ts";
import type { IpcBus } from "../ipc-handlers.ts";
import { pageEvent } from "../ipc-handlers.ts";
import type { UpdateService } from "./service.ts";

export function registerUpdateHandlers(bus: IpcBus, trusted: () => Trusted, updates: UpdateService): void {
  const onList = (e: Parameters<typeof pageEvent>[0]): boolean => pageEvent(e, trusted) === UPDATE_PAGE;
  bus.handle(CH_UPDATE_STATUS, (e, raw) => (onList(e) && raw === undefined ? updates.view() : null));
  bus.handle(CH_UPDATE_CHECK, (e, raw) => (onList(e) && raw === undefined ? updates.checkNow() : null));
  // Answers nothing either way (updates.md, "No feedback when the browser fails to open").
  bus.handle(CH_UPDATE_OPEN_RELEASE, (e, raw) => {
    if (onList(e) && raw === undefined) updates.openReleasePage();
    return null;
  });
  bus.handle(CH_UPDATE_SET_AUTO, (e, raw) => (onList(e) && typeof raw === "boolean" ? updates.setAutomaticChecks(raw) : null));
  bus.handle(CH_UPDATE_SET_PRERELEASES, (e, raw) => (onList(e) && typeof raw === "boolean" ? updates.setPrereleases(raw) : null));
}
