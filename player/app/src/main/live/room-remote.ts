// The room window's phone-remote slot, joined to the live client (issue #202; room-2d.md, "The
// class code"). The Phone remote button starts the live session and End class stops it, through
// the same service as the presenter's panel; nothing here starts it by itself. What the room is
// told is the service's room view only, as remoteViewOf leaves it, and only when it changed.
import { remoteViewOf } from "../../core/room/remote.ts";
import type { RemoteView, RoomRemote } from "../../core/room/remote.ts";
import { listenerLine } from "./log-lines.ts";
import type { LiveService } from "./live-service.ts";

export interface LiveRoomRemote extends RoomRemote {
  /** Reads the slot again (the pairing or the open class may have changed) and tells it if it changed. */
  refresh(): void;
}

/**
 * `log` takes the fixed line for a slot listener that threw (default console.warn): one that throws
 * never stops the others, the live service or the class controller that asked for the refresh.
 */
export function liveRoomRemote(live: Pick<LiveService, "roomView" | "onChange" | "start" | "end">, log: (line: string) => void = console.warn): LiveRoomRemote {
  const listeners: ((v: RemoteView) => void)[] = [];
  const view = (): RemoteView => remoteViewOf(live.roomView());
  let last = JSON.stringify(view());
  const refresh = (): void => {
    const v = view();
    const text = JSON.stringify(v);
    if (text === last) return;
    last = text;
    for (const l of listeners) {
      try {
        l(v);
      } catch (err) {
        log(listenerLine(err));
      }
    }
  };
  live.onChange(refresh);
  return {
    view,
    start: () => void live.start(),
    stop: () => void live.end(),
    watch(listener) {
      listeners.push(listener);
    },
    refresh,
  };
}
