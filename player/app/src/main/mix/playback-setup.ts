// Joins mix playback to the shell (ADR 0013 section 5): the mix player gets every snapshot before
// the room window does, so the room's link line is current; the `cbp-mix:` scheme answers the live
// play only; the room's reports and its closing reach the player. Call once the app is ready,
// after `hardenSession` and `setupMix`, and before the room window is watched. The mixes the synced
// classes name are downloaded ahead when the classes sync and when the account signs in.
import { performance } from "node:perf_hooks";
import type { Controller } from "../controller.ts";
import type { RoomWindow } from "../room/room-window.ts";
import { createMixPlayer } from "./mix-player.ts";
import type { MixPlayer } from "./mix-player.ts";
import type { Plays } from "./plays.ts";
import { handleMixScheme } from "../hardening.ts";
import type { MixSetup } from "./setup.ts";
import { createPrefetch } from "./prefetch.ts";
import type { Prefetch } from "./prefetch.ts";
import type { SyncService } from "../sync/service.ts";

export function setupPlayback(mix: MixSetup, plays: Plays, controller: Pick<Controller, "watch" | "align">, room: Pick<RoomWindow, "trusted" | "sendMix">, sync: Pick<SyncService, "mixes" | "watch">): { player: MixPlayer; prefetch: Prefetch } {
  const listed = (): readonly string[] => sync.mixes();
  const player = createMixPlayer({
    cache: mix.cache,
    plays,
    view: () => mix.service.view(),
    account: mix.account,
    roomId: () => room.trusted().roomId,
    cue: (c) => room.sendMix(c),
    align: (classMs) => controller.align(classMs),
    now: () => performance.now(),
    listed,
  });
  const prefetch = createPrefetch({ cache: mix.cache, view: () => mix.service.view(), account: mix.account, listed });
  handleMixScheme({ live: (id) => plays.live(id), open: (a, m) => mix.cache.open(a, m), onFault: (id, f) => player.fault(id, f) });
  controller.watch((s) => player.snapshot(s));
  // Sign-in has no event of its own: the sign-in handler and each snapshot check it; it acts only when it changed.
  controller.watch(() => prefetch.check());
  sync.watch(() => prefetch.synced());
  prefetch.check();
  return { player, prefetch };
}
