// Joins mix playback to the shell (ADR 0013 section 5): the mix player gets every snapshot before
// the room window does, so the room's link line is current; the `cbp-mix:` scheme answers the live
// play only; the room's reports and its closing reach the player. Call once the app is ready,
// after `hardenSession` and `setupMix`, and before the room window is watched.
import { performance } from "node:perf_hooks";
import type { Controller } from "../controller.ts";
import type { RoomWindow } from "../room/room-window.ts";
import { createMixPlayer } from "./mix-player.ts";
import type { MixPlayer } from "./mix-player.ts";
import type { Plays } from "./plays.ts";
import { handleMixScheme } from "./scheme.ts";
import type { MixSetup } from "./setup.ts";

export function setupPlayback(mix: MixSetup, plays: Plays, controller: Pick<Controller, "watch" | "align">, room: Pick<RoomWindow, "trusted" | "sendMix">): MixPlayer {
  const player = createMixPlayer({
    cache: mix.cache,
    plays,
    view: () => mix.service.view(),
    account: mix.account,
    roomId: () => room.trusted().roomId,
    cue: (c) => room.sendMix(c),
    align: (classMs) => controller.align(classMs),
    now: () => performance.now(),
  });
  handleMixScheme({ live: (id) => plays.live(id), open: (a, m) => mix.cache.open(a, m), onFault: (id, f) => player.fault(id, f) });
  controller.watch((s) => player.snapshot(s));
  return player;
}
