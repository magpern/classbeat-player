// The room screen's only door to the shell, apart from the presenter's (preload.ts): it reads
// what to draw and nothing else. No command, no pairing, no file: the room screen has no controls
// (room-2d.md, rule 1). Runs sandboxed; no Node, no ipcRenderer and no event objects reach the page.
import { contextBridge, ipcRenderer } from "electron";
import { CH_ROOM_STATE, CH_ROOM_UPDATE } from "../core/channels.ts";

contextBridge.exposeInMainWorld("room", {
  state: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_STATE),
  onUpdate: (cb: (frame: unknown) => void): void => {
    if (typeof cb !== "function") return;
    ipcRenderer.on(CH_ROOM_UPDATE, (_e, frame: unknown) => cb(frame));
  },
});
