// IPC handlers. Every message is checked twice before use: the sender (only the presenter's top
// frame on the shipped presenter page, core/ipc-policy.ts) and the shape (core/commands.ts).
// A refused message gets null and changes nothing.
import { ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { CH_COMMAND, CH_OPEN_DROPPED, CH_STATE } from "../core/channels.ts";
import { parseClockCommand, parseDroppedFile } from "../core/commands.ts";
import { isTrustedSender } from "../core/ipc-policy.ts";
import type { Trusted } from "../core/ipc-policy.ts";
import type { Controller } from "./controller.ts";

export function trustedEvent(e: IpcMainInvokeEvent, trusted: () => Trusted): boolean {
  const frame = e.senderFrame;
  if (frame === null) return false;
  return isTrustedSender({ senderId: e.sender.id, topFrame: frame.parent === null, frameUrl: frame.url }, trusted());
}

export function registerIpc(controller: Controller, trusted: () => Trusted): void {
  ipcMain.handle(CH_STATE, (e) => (trustedEvent(e, trusted) ? controller.snapshot() : null));
  ipcMain.handle(CH_COMMAND, (e, raw: unknown) => {
    if (!trustedEvent(e, trusted)) return null;
    const cmd = parseClockCommand(raw);
    return cmd ? controller.command(cmd) : null;
  });
  ipcMain.handle(CH_OPEN_DROPPED, (e, raw: unknown) => {
    if (!trustedEvent(e, trusted)) return null;
    const file = parseDroppedFile(raw);
    return file ? controller.open(file.name, file.text) : null;
  });
}
