// Builds the update checker from Electron (ADR 0014). Call once the app is ready. It tells only:
// nothing is downloaded or installed, and there is no install path in this build.
import { app, shell } from "electron";
import { createFeedFetch } from "./feed-fetch.ts";
import { createUpdateService } from "./service.ts";
import type { UpdateService } from "./service.ts";
import { settingsFile } from "./settings-file.ts";

export function setupUpdates(classOpen: () => boolean): UpdateService {
  const current = app.getVersion();
  const updates = createUpdateService({
    current,
    fetchFeed: createFeedFetch(current),
    store: settingsFile(app.getPath("userData")),
    classOpen,
    // Only an address from releasePageAddress (the fixed release-page prefix and a checked version) reaches it.
    openPage: (address) => void shell.openExternal(address).catch(() => undefined),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
  });
  updates.start();
  return updates;
}
