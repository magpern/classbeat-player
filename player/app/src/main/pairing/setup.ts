// Builds the pairing service from Electron and the settings. Call once the app is ready (safeStorage
// needs it on Linux).
//
// Settings: PLAYER_BACKEND_ORIGIN is the backend's address (HTTPS; loopback HTTP only in a
// development run, never in a packaged build). The --test-memory-keychain switch keeps the pairing
// in memory for the run instead of the keychain; it is honoured only outside a packaged build, for
// the e2e test against a fake backend.
import { app, safeStorage, shell } from "electron";
import { parseBackendOrigin } from "../../core/pairing/origin.ts";
import { createBackendCall } from "./http.ts";
import { keychainStore, memoryStore } from "./keychain.ts";
import { createPairingService } from "./service.ts";
import type { PairingService } from "./service.ts";

export const ORIGIN_SETTING = "PLAYER_BACKEND_ORIGIN";
export const MEMORY_KEYCHAIN_SWITCH = "test-memory-keychain";

export function setupPairing(): PairingService {
  const development = !app.isPackaged;
  const store = development && app.commandLine.hasSwitch(MEMORY_KEYCHAIN_SWITCH) ? memoryStore() : keychainStore(safeStorage, app.getPath("userData"), process.platform);
  const service = createPairingService({
    now: () => Date.now(),
    call: createBackendCall(),
    store,
    // Only a page on the backend's own origin reaches here (core/pairing/origin.ts).
    openPage: (url) => void shell.openExternal(url).catch(() => undefined),
    origin: () => parseBackendOrigin(process.env[ORIGIN_SETTING], development),
    allowLoopbackHttp: development,
    platform: process.platform,
    version: app.getVersion(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
  });
  service.load();
  return service;
}
