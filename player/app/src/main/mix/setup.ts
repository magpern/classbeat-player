// Builds the Swedebeat sign-in service from Electron and the settings. Call once the app is ready
// (safeStorage needs it on Linux), after the pairing. The source is the unavailable one in every
// build until the real client exists (core/mix/source-setting.ts): the sign-in is then never
// offered, and nothing here reaches the network.
import { app, safeStorage } from "electron";
import { chooseMixSource } from "../../core/mix/source-setting.ts";
import type { PairingService } from "../pairing/service.ts";
import { credentialOf } from "../sync/link.ts";
import { createMixService } from "./service.ts";
import type { MixService } from "./service.ts";
import { keychainVault } from "./vault.ts";

export function setupMix(paired: PairingService): MixService {
  const service = createMixService({
    source: chooseMixSource(),
    vault: keychainVault(safeStorage, app.getPath("userData"), process.platform),
    account: () => credentialOf(paired)?.account ?? null,
  });
  // Unpairing and deleting the account both end here: key, token, then the mixes, for every account.
  paired.watch((change) => {
    if (change === "forgotten") void service.forgotten();
  });
  service.sweep();
  return service;
}
