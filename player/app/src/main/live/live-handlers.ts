// The phone-remote panel's IPC handlers, written against the same small `IpcBus` as the others.
// Only the presenter page of the main window may use them (core/ipc-policy.ts): the class list,
// a subframe, any other page and the room window get null, before anything is read. What they
// answer is the presenter's LivePanelView, which alone carries the control code, or its RidersView,
// which alone carries the riders' nicknames (ADR 0007 section 4).
import type { IpcMainInvokeEvent } from "electron";
import {
  CH_LIVE_CODE,
  CH_LIVE_DROP,
  CH_LIVE_DROP_RIDER,
  CH_LIVE_END,
  CH_LIVE_LOCK,
  CH_LIVE_NEW_CODE,
  CH_LIVE_RIDERS,
  CH_LIVE_START,
  CH_LIVE_VIEW,
} from "../../core/channels.ts";
import { isRiderId } from "../../core/live/host-wire.ts";
import type { Trusted } from "../../core/ipc-policy.ts";
import { pageEvent } from "../ipc-handlers.ts";
import type { IpcBus } from "../ipc-handlers.ts";
import type { LiveService } from "./live-service.ts";

export const LIVE_CHANNELS: readonly string[] = [
  CH_LIVE_VIEW,
  CH_LIVE_START,
  CH_LIVE_END,
  CH_LIVE_CODE,
  CH_LIVE_DROP,
  CH_LIVE_RIDERS,
  CH_LIVE_DROP_RIDER,
  CH_LIVE_LOCK,
  CH_LIVE_NEW_CODE,
];

export function registerLiveHandlers(bus: IpcBus, trusted: () => Trusted, live: LiveService): void {
  const presenter = (e: IpcMainInvokeEvent): boolean => pageEvent(e, trusted) === "presenter";
  bus.handle(CH_LIVE_VIEW, (e) => (presenter(e) ? live.view() : null));
  bus.handle(CH_LIVE_START, (e) => (presenter(e) ? live.start() : null));
  bus.handle(CH_LIVE_END, (e) => (presenter(e) ? live.end() : null));
  bus.handle(CH_LIVE_CODE, (e) => (presenter(e) ? live.makeCode() : null));
  bus.handle(CH_LIVE_DROP, (e, raw) => {
    if (!presenter(e)) return null;
    return raw === 1 || raw === 2 ? live.drop(raw) : null;
  });
  bus.handle(CH_LIVE_RIDERS, (e) => (presenter(e) ? live.riders() : null));
  bus.handle(CH_LIVE_DROP_RIDER, (e, raw) => {
    if (!presenter(e)) return null;
    return isRiderId(raw) ? live.dropRider(raw) : null;
  });
  bus.handle(CH_LIVE_LOCK, (e, raw) => {
    if (!presenter(e)) return null;
    return raw === true || raw === false ? live.lock(raw) : null;
  });
  bus.handle(CH_LIVE_NEW_CODE, (e) => (presenter(e) ? live.newJoinCode() : null));
}
