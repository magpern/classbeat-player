// The room window's IPC handlers, written against the same `IpcBus` as the others so a test can
// drive them without Electron. Only the room window's top frame on the room page is answered: it
// gets a RoomFrame (core/room/frame.ts), never the presenter's snapshot, and the phone remote's
// slot as remoteViewOf leaves it (core/room/remote.ts). The sender check comes first, before
// anything is parsed. `room:state` reads nothing sent with it; `room:command` takes one of the
// room's clock commands (core/room/commands.ts) and the other channels no argument at all. A
// refused message gets null, changes nothing and is logged by its channel and reason, never with
// what was sent.
import type { IpcMainInvokeEvent } from "electron";
import { CH_ROOM_COMMAND, CH_ROOM_END, CH_ROOM_REMOTE_START, CH_ROOM_REMOTE_STATE, CH_ROOM_REMOTE_STOP, CH_ROOM_STATE } from "../../core/channels.ts";
import { isRoomSender } from "../../core/ipc-policy.ts";
import type { RoomTrusted } from "../../core/ipc-policy.ts";
import { parseRoomCommand } from "../../core/room/commands.ts";
import { roomFrameOf } from "../../core/room/frame.ts";
import type { RoomFrame } from "../../core/room/frame.ts";
import { remoteViewOf } from "../../core/room/remote.ts";
import type { RemoteView, RoomRemote } from "../../core/room/remote.ts";
import type { Controller } from "../controller.ts";
import type { IpcBus } from "../ipc-handlers.ts";

export type RefusalReason = "sender" | "command" | "argument";

/** What the room's controls reach in the shell (main.ts). */
export interface RoomHost {
  /** End class: the class is no longer pinned, the class list comes back and the room window closes. */
  readonly endClass: () => void;
  readonly remote: RoomRemote;
  /** Where a refusal is written: one line with the channel and the reason, nothing sent with it. */
  readonly log?: (line: string) => void;
}

export const refusalLine = (channel: string, why: RefusalReason): string => `room window: refused a message on ${channel} (${why})`;

export function roomEvent(e: IpcMainInvokeEvent, trusted: () => RoomTrusted): boolean {
  const frame = e.senderFrame;
  if (frame === null) return false;
  return isRoomSender({ senderId: e.sender.id, topFrame: frame.parent === null, frameUrl: frame.url }, trusted());
}

export function registerRoomHandlers(bus: IpcBus, trusted: () => RoomTrusted, controller: Pick<Controller, "snapshot" | "command">, host: RoomHost): void {
  const log = host.log ?? ((line: string) => console.warn(line));
  const refuse = (channel: string, why: RefusalReason): null => {
    log(refusalLine(channel, why));
    return null;
  };
  const remote = (): RemoteView => remoteViewOf(host.remote.view());
  // A channel that takes no argument: anything sent with it is refused, unread.
  const bare = <T>(channel: string, run: () => T): void =>
    bus.handle(channel, (e, raw) => (!roomEvent(e, trusted) ? refuse(channel, "sender") : raw !== undefined ? refuse(channel, "argument") : run()));

  bus.handle(CH_ROOM_STATE, (e): RoomFrame | null => (roomEvent(e, trusted) ? roomFrameOf(controller.snapshot()) : null));
  bus.handle(CH_ROOM_COMMAND, (e, raw): RoomFrame | null => {
    if (!roomEvent(e, trusted)) return refuse(CH_ROOM_COMMAND, "sender");
    const cmd = parseRoomCommand(raw);
    return cmd === null ? refuse(CH_ROOM_COMMAND, "command") : roomFrameOf(controller.command(cmd));
  });
  bare(CH_ROOM_END, () => {
    host.endClass();
    return true;
  });
  bare(CH_ROOM_REMOTE_STATE, remote);
  bare(CH_ROOM_REMOTE_START, () => {
    host.remote.start();
    return remote();
  });
  bare(CH_ROOM_REMOTE_STOP, () => {
    host.remote.stop();
    return remote();
  });
}
