// The room window's one IPC handler, written against the same `IpcBus` as the others so a test can
// drive it without Electron. Only the room window's top frame on the room page is answered, and it
// gets a RoomFrame (core/room/frame.ts), never the presenter's snapshot. Anything sent with the
// message is never read.
import type { IpcMainInvokeEvent } from "electron";
import { CH_ROOM_STATE } from "../../core/channels.ts";
import { isRoomSender } from "../../core/ipc-policy.ts";
import type { RoomTrusted } from "../../core/ipc-policy.ts";
import { roomFrameOf } from "../../core/room/frame.ts";
import type { RoomFrame } from "../../core/room/frame.ts";
import type { Controller } from "../controller.ts";
import type { IpcBus } from "../ipc-handlers.ts";

export function roomEvent(e: IpcMainInvokeEvent, trusted: () => RoomTrusted): boolean {
  const frame = e.senderFrame;
  if (frame === null) return false;
  return isRoomSender({ senderId: e.sender.id, topFrame: frame.parent === null, frameUrl: frame.url }, trusted());
}

export function registerRoomHandlers(bus: IpcBus, trusted: () => RoomTrusted, controller: Pick<Controller, "snapshot">): void {
  bus.handle(CH_ROOM_STATE, (e): RoomFrame | null => (roomEvent(e, trusted) ? roomFrameOf(controller.snapshot()) : null));
}
