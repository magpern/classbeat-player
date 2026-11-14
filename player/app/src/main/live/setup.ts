// Builds the live session from Electron, the controller and the pairing. Off until the instructor
// asks for it in the presenter. The device token is read from the pairing for the one start
// request; the backend's address is the pairing's own origin, so the token only goes where it was
// issued. "Second display" is more than one display: the room screen is then on another one
// (core/room/placement.ts) and the presenter, with its control code, is not seen by the room.
// When a display is removed or mirrored and only one is left, the control code held is cancelled
// (displays.ts; #353, #381).
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { screen } from "electron";
import { CLOSE_ABNORMAL } from "../../core/live/session-model.ts";
import type { Controller } from "../controller.ts";
import { createBackendCall } from "../pairing/http.ts";
import type { PairingService } from "../pairing/service.ts";
import { watchDisplays } from "./displays.ts";
import { webSocketConnect } from "./live-socket.ts";
import { createLiveService } from "./live-service.ts";
import type { LiveService } from "./live-service.ts";

export function setupLive(controller: Controller, pairing: PairingService): LiveService {
  const live = createLiveService({
    now: () => performance.now(),
    runId: () => randomBytes(16).toString("base64url"),
    credential: () => {
      const c = pairing.credential();
      return c === null ? null : { origin: c.record.origin, token: c.record.token, expired: c.expired };
    },
    call: createBackendCall(),
    connect: webSocketConnect(CLOSE_ABNORMAL),
    host: { read: () => controller.read(), apply: (cmd) => void controller.command(cmd) },
    classOpen: () => controller.snapshot().doc !== null,
    secondDisplay: () => screen.getAllDisplays().length > 1,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
  });
  // A display removed, or mirrored, may leave only one: the control code held then ends (#353, #381).
  watchDisplays(screen, () => live.displaysChanged());
  return live;
}
