// The pages' only door to the shell: plain data in and out. Runs sandboxed; no Node, no
// ipcRenderer and no event objects reach the page. Both shipped pages (the class list and the
// presenter) get the same object; the shell answers each page only on its own channels.
import { contextBridge, ipcRenderer } from "electron";
import {
  CH_COMMAND,
  CH_LIST_BACK,
  CH_LIST_DISMISS,
  CH_LIST_OPEN_FILE,
  CH_LIST_START,
  CH_LIST_VIEW,
  CH_LIVE_CODE,
  CH_LIVE_DROP,
  CH_LIVE_END,
  CH_LIVE_START,
  CH_LIVE_VIEW,
  CH_OPEN_DROPPED,
  CH_PAIRING_REOPEN,
  CH_PAIRING_START,
  CH_PAIRING_STATE,
  CH_STATE,
  CH_UNPAIR,
  CH_UPDATE,
} from "../core/channels.ts";

contextBridge.exposeInMainWorld("player", {
  getState: (): Promise<unknown> => ipcRenderer.invoke(CH_STATE),
  command: (cmd: unknown): Promise<unknown> => ipcRenderer.invoke(CH_COMMAND, cmd),
  openDropped: (name: unknown, text: unknown): Promise<unknown> => ipcRenderer.invoke(CH_OPEN_DROPPED, { name, text }),
  onUpdate: (cb: (snapshot: unknown) => void): void => {
    if (typeof cb !== "function") return;
    ipcRenderer.on(CH_UPDATE, (_e, snapshot: unknown) => cb(snapshot));
  },
  // Pairing: no arguments cross, and what comes back never holds the device code or the token.
  startPairing: (): Promise<unknown> => ipcRenderer.invoke(CH_PAIRING_START),
  pairingState: (): Promise<unknown> => ipcRenderer.invoke(CH_PAIRING_STATE),
  reopenPairingPage: (): Promise<unknown> => ipcRenderer.invoke(CH_PAIRING_REOPEN),
  unpair: (): Promise<unknown> => ipcRenderer.invoke(CH_UNPAIR),
  // The class list: what it shows, Start (a class's id and hash), Open a class file, Close on
  // the file-error plate, Back to the class. Each answers with the list as it is now.
  listView: (): Promise<unknown> => ipcRenderer.invoke(CH_LIST_VIEW),
  startClass: (id: unknown, hash: unknown): Promise<unknown> => ipcRenderer.invoke(CH_LIST_START, { id, hash }),
  openClassFile: (): Promise<unknown> => ipcRenderer.invoke(CH_LIST_OPEN_FILE),
  dismissFileError: (): Promise<unknown> => ipcRenderer.invoke(CH_LIST_DISMISS),
  backToClass: (): Promise<unknown> => ipcRenderer.invoke(CH_LIST_BACK),
  // The phone remote (presenter only): what the panel shows, start, end, a control code, Drop a
  // phone's place (1 or 2). The answer never holds the host token.
  liveView: (): Promise<unknown> => ipcRenderer.invoke(CH_LIVE_VIEW),
  startLive: (): Promise<unknown> => ipcRenderer.invoke(CH_LIVE_START),
  endLive: (): Promise<unknown> => ipcRenderer.invoke(CH_LIVE_END),
  makeControlCode: (): Promise<unknown> => ipcRenderer.invoke(CH_LIVE_CODE),
  dropPhone: (slot: unknown): Promise<unknown> => ipcRenderer.invoke(CH_LIVE_DROP, slot),
});
