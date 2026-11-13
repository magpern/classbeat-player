// The only file that calls Electron's powerSaveBlocker (the thin adapter behind keep-awake.ts).
import { powerSaveBlocker } from "electron";
import type { Blocker } from "./keep-awake.ts";

export const electronBlocker: Blocker = {
  start: (type) => powerSaveBlocker.start(type),
  stop: (id) => powerSaveBlocker.stop(id),
};
