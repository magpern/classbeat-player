// The room screen's only door to the shell, apart from the presenter's (preload.ts): it reads what
// to draw and the phone remote's slot, and sends the one-screen controls (room-2d.md, "What the
// room window needs from the desktop shell"). No function takes an argument from the page: each
// sends one fixed message, and the shell checks it again (main/room/room-handlers.ts). No pairing,
// no file, no free text. Runs sandboxed; no Node, no ipcRenderer and no event objects reach the page.
import { contextBridge, ipcRenderer } from "electron";
import { CH_ROOM_COMMAND, CH_ROOM_END, CH_ROOM_REMOTE_START, CH_ROOM_REMOTE_STATE, CH_ROOM_REMOTE_STOP, CH_ROOM_REMOTE_UPDATE, CH_ROOM_STATE, CH_ROOM_UPDATE } from "../core/channels.ts";

contextBridge.exposeInMainWorld("room", {
  state: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_STATE),
  onUpdate: (cb: (frame: unknown) => void): void => {
    if (typeof cb !== "function") return;
    ipcRenderer.on(CH_ROOM_UPDATE, (_e, frame: unknown) => cb(frame));
  },
  // The band's and the keyboard's clock commands; each answers with the frame as it is now.
  start: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_COMMAND, { type: "start" }),
  pause: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_COMMAND, { type: "pause" }),
  resume: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_COMMAND, { type: "resume" }),
  previous: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_COMMAND, { type: "previous" }),
  next: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_COMMAND, { type: "next" }),
  forward: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_COMMAND, { type: "jump", deltaMs: 5000 }),
  back: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_COMMAND, { type: "jump", deltaMs: -5000 }),
  undo: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_COMMAND, { type: "undo" }),
  follow: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_COMMAND, { type: "follow" }),
  // End class (and Close class on Class Complete).
  endClass: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_END),
  // The phone remote's slot: its state, the instructor's start and stop, and the shell's pushes.
  remoteState: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_REMOTE_STATE),
  startRemote: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_REMOTE_START),
  stopRemote: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_REMOTE_STOP),
  onRemote: (cb: (slot: unknown) => void): void => {
    if (typeof cb !== "function") return;
    ipcRenderer.on(CH_ROOM_REMOTE_UPDATE, (_e, slot: unknown) => cb(slot));
  },
});
