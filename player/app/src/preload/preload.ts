// The presenter's only door to the shell: four functions, plain data in and out. Runs sandboxed;
// no Node, no ipcRenderer and no event objects reach the page.
import { contextBridge, ipcRenderer } from "electron";
import { CH_COMMAND, CH_OPEN_DROPPED, CH_STATE, CH_UPDATE } from "../core/channels.ts";

contextBridge.exposeInMainWorld("player", {
  getState: (): Promise<unknown> => ipcRenderer.invoke(CH_STATE),
  command: (cmd: unknown): Promise<unknown> => ipcRenderer.invoke(CH_COMMAND, cmd),
  openDropped: (name: unknown, text: unknown): Promise<unknown> => ipcRenderer.invoke(CH_OPEN_DROPPED, { name, text }),
  onUpdate: (cb: (snapshot: unknown) => void): void => {
    if (typeof cb !== "function") return;
    ipcRenderer.on(CH_UPDATE, (_e, snapshot: unknown) => cb(snapshot));
  },
});
