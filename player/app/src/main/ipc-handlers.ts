// The IPC handlers, written against a small `IpcBus` so a test can drive them without Electron.
// Every message is checked twice before use: the sender (only the main window's top frame on a
// page shipped with the application, core/ipc-policy.ts) and the shape (core/commands.ts). The
// sender check comes first, before anything is parsed. A refused message gets null and changes
// nothing. The clock's channels belong to the presenter page, the class list's to the list page;
// the pairing is used from both.
import type { IpcMainInvokeEvent } from "electron";
import { CH_COMMAND, CH_OPEN_DROPPED, CH_PAIRING_REOPEN, CH_PAIRING_START, CH_PAIRING_STATE, CH_STATE, CH_UNPAIR } from "../core/channels.ts";
import { parseClockCommand, parseDroppedFile, parseMusicCommand } from "../core/commands.ts";
import { pageOf } from "../core/ipc-policy.ts";
import type { Page, Trusted } from "../core/ipc-policy.ts";
import type { Controller } from "./controller.ts";
import type { PairingService } from "./pairing/service.ts";

/** The part of Electron's `ipcMain` the handlers use. */
export interface IpcBus {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, raw: unknown) => unknown): void;
}

/** Which shipped page sent the message, or null when it is not to be trusted. */
export function pageEvent(e: IpcMainInvokeEvent, trusted: () => Trusted): Page | null {
  const frame = e.senderFrame;
  if (frame === null) return null;
  return pageOf({ senderId: e.sender.id, topFrame: frame.parent === null, frameUrl: frame.url }, trusted());
}

/** Either shipped page. */
export const trustedEvent = (e: IpcMainInvokeEvent, trusted: () => Trusted): boolean => pageEvent(e, trusted) !== null;

export function registerHandlers(bus: IpcBus, controller: Controller, trusted: () => Trusted, pairing: PairingService): void {
  const presenter = (e: IpcMainInvokeEvent): boolean => pageEvent(e, trusted) === "presenter";
  bus.handle(CH_STATE, (e) => (presenter(e) ? controller.snapshot() : null));
  bus.handle(CH_COMMAND, (e, raw) => {
    if (!presenter(e)) return null;
    const music = parseMusicCommand(raw);
    if (music) return controller.music(music.action);
    const cmd = parseClockCommand(raw);
    return cmd ? controller.command(cmd) : null;
  });
  bus.handle(CH_OPEN_DROPPED, (e, raw) => {
    if (!presenter(e)) return null;
    const file = parseDroppedFile(raw);
    return file ? controller.open(file.name, file.text) : null;
  });
  // Pairing takes no argument from the page: whatever is sent with it is never read.
  bus.handle(CH_PAIRING_STATE, (e) => (trustedEvent(e, trusted) ? pairing.view() : null));
  bus.handle(CH_PAIRING_START, (e) => (trustedEvent(e, trusted) ? pairing.start() : null));
  bus.handle(CH_PAIRING_REOPEN, (e) => (trustedEvent(e, trusted) ? pairing.reopenPage() : null));
  bus.handle(CH_UNPAIR, (e) => (trustedEvent(e, trusted) ? pairing.unpair() : null));
}
