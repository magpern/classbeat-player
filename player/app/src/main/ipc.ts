// Registers the IPC handlers (src/main/ipc-handlers.ts) on Electron's ipcMain.
import { ipcMain } from "electron";
import type { Trusted } from "../core/ipc-policy.ts";
import type { Controller } from "./controller.ts";
import { registerHandlers } from "./ipc-handlers.ts";
import type { PairingService } from "./pairing/service.ts";

export { trustedEvent } from "./ipc-handlers.ts";

export function registerIpc(controller: Controller, trusted: () => Trusted, pairing: PairingService, onDropOpened: () => void): void {
  registerHandlers(ipcMain, controller, trusted, pairing, onDropOpened);
}
