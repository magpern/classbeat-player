// Builds the Swedebeat sign-in service and the mix cache from Electron and the settings. Call once
// the app is ready (safeStorage needs it on Linux), after the pairing. The source is the
// unavailable one in every build until the real client exists (core/mix/source-setting.ts): the
// sign-in is then never offered, and nothing here reaches the network. Only an unpackaged build
// started with the end-to-end tests' switch gets the in-memory test source (main/mix/test-mix.ts).
import { app, safeStorage } from "electron";
import { chooseMixSource } from "../../core/mix/source-setting.ts";
import type { PairingService } from "../pairing/service.ts";
import { credentialOf } from "../sync/link.ts";
import { createMixCache } from "./mix-cache.ts";
import type { MixCache } from "./mix-cache.ts";
import type { Plays } from "./plays.ts";
import { createMixService } from "./service.ts";
import type { MixService } from "./service.ts";
import { TEST_ACCOUNT, testMixOn, testMixSource, testMixVault } from "./test-mix.ts";
import { keychainVault } from "./vault.ts";

export interface MixSetup {
  readonly service: MixService;
  readonly cache: MixCache;
  /** The key of the account the mixes are for, or null. */
  readonly account: () => string | null;
}

export function setupMix(paired: PairingService, plays: Plays): MixSetup {
  const root = app.getPath("userData");
  const test = testMixOn(app);
  const source = test ? testMixSource() : chooseMixSource();
  const vault = test ? testMixVault(root) : keychainVault(safeStorage, root, process.platform);
  const account = test ? () => TEST_ACCOUNT : () => credentialOf(paired)?.account ?? null;
  let service: MixService | null = null;
  const cache = createMixCache({ source, vault, root, now: Date.now, onTokenInvalid: (a) => service?.tokenInvalid(a) });
  service = createMixService({
    source,
    vault,
    account,
    // Sign-out ends the account's play first, then its downloads, before its folder goes.
    cancelDownloads: async (a) => {
      plays.endAccount(a);
      await cache.cancel(a);
    },
  });
  const s = service;
  // Unpairing and deleting the account both end here: key, token, then the mixes, for every account.
  paired.watch((change) => {
    if (change === "forgotten") void s.forgotten();
  });
  s.sweep();
  return { service: s, cache, account };
}
