// How the room screen's script tells the scene's script (room-scene.ts, a separate bundle) that it drew a frame: a list of listeners on
// the page's own window object, which the scene's script joins. Nothing leaves the page. A listener that throws never stops the plain
// screen's script: the error is reported on its own turn and the other listeners still get the frame.
import type { RoomFrame } from "../core/room/frame.ts";

export interface FrameHost {
  classbeatRoomFrameListeners?: ((frame: RoomFrame) => void)[];
  /** The last frame announced: a script that joins late (the scene's is loaded after this one) is given it at once. */
  classbeatRoomFrameLast?: RoomFrame;
}

declare global {
  interface Window {
    classbeatRoomFrameListeners?: FrameHost["classbeatRoomFrameListeners"];
    classbeatRoomFrameLast?: FrameHost["classbeatRoomFrameLast"];
  }
}

/** `report` takes a listener's error; by default it is thrown on its own turn, where the page reports it. */
export function announceFrame(host: FrameHost, frame: RoomFrame, report: (e: unknown) => void = (e) => queueMicrotask(() => { throw e; })): void {
  host.classbeatRoomFrameLast = frame;
  for (const listener of host.classbeatRoomFrameListeners ?? []) {
    try {
      listener(frame);
    } catch (e) {
      report(e);
    }
  }
}

/** Calls `listener` with the last frame announced on `host`, if any, and then with each new one; returns how to stop. */
export function onFrame(host: FrameHost, listener: (frame: RoomFrame) => void): () => void {
  (host.classbeatRoomFrameListeners ??= []).push(listener);
  if (host.classbeatRoomFrameLast !== undefined) listener(host.classbeatRoomFrameLast);
  return () => { host.classbeatRoomFrameListeners = (host.classbeatRoomFrameListeners ?? []).filter((l) => l !== listener); };
}
