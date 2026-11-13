// The room screen's window: the plain 2D room screen (web/, docs/design/room-2d.md) drawn from what
// the shell sends. The screen is the web lane's; this page only mounts it and passes it frames.
// It has no controls, sends nothing and reads nothing but its frames.
import "../../../../web/src/main.ts";
import type { RoomFrame } from "../core/room/frame.ts";

interface RoomApi {
  state(): Promise<RoomFrame | null>;
  onUpdate(cb: (frame: RoomFrame) => void): void;
}

const api = (window as unknown as { room: RoomApi }).room;
const screen = window.classbeatRoom.mount(document.body);
// A push can arrive before the first answer; the older answer then does not draw over it.
let pushed = false;
api.onUpdate((frame) => {
  pushed = true;
  screen.update(frame);
});
void api.state().then((frame) => {
  if (frame && !pushed) screen.update(frame);
});
