// How the room screen's script tells the scene's script (room-scene.ts, a separate bundle) that it drew a frame: one DOM event on
// the page's own document, carrying the frame the plain screen was just given. Nothing leaves the page; the scene's script reads it.
import type { RoomFrame } from "../core/room/frame.ts";

export const ROOM_FRAME_EVENT = "classbeat:room-frame";

export function announceFrame(target: EventTarget, frame: RoomFrame): void {
  target.dispatchEvent(new CustomEvent<RoomFrame>(ROOM_FRAME_EVENT, { detail: frame }));
}

/** Calls `listener` with each frame announced on `target`; returns how to stop. */
export function onFrame(target: EventTarget, listener: (frame: RoomFrame) => void): () => void {
  const handler = (e: Event): void => listener((e as CustomEvent<RoomFrame>).detail);
  target.addEventListener(ROOM_FRAME_EVENT, handler);
  return () => target.removeEventListener(ROOM_FRAME_EVENT, handler);
}
