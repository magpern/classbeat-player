// Builds class sync from Electron and the pairing. Call once the pairing service is set up.
// The cache lives in the app's own folder; the token is read from the pairing, never kept here.
import { join } from "node:path";
import { app } from "electron";
import { createBackendCall } from "../pairing/http.ts";
import type { PairingService } from "../pairing/service.ts";
import { classCache } from "./cache.ts";
import { credentialOf, linkAndStart } from "./link.ts";
import { createSyncService } from "./service.ts";
import type { SyncService } from "./service.ts";

export const CACHE_DIR = "class-cache";

export function setupSync(pairing: PairingService): SyncService {
  const sync = createSyncService({
    now: () => Date.now(),
    call: createBackendCall(),
    cache: classCache(join(app.getPath("userData"), CACHE_DIR)),
    credential: () => credentialOf(pairing),
    report: (kind) => pairing.tokenRefused(kind),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
  });
  linkAndStart(pairing, sync);
  return sync;
}
