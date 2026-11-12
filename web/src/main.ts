// The room screen's entry for the shell: `classbeatRoom.mount(host)` returns a screen that redraws
// from each snapshot the shell sends. No fixtures, no network, no dependency on the player.
import "./design/tokens.css";
import "./room/room.css";
import { mountRoom } from "./room/mount.ts";
import type { RoomOptions, RoomScreen } from "./room/mount.ts";

declare global {
  interface Window {
    classbeatRoom: { mount(host: HTMLElement, opts?: RoomOptions): RoomScreen };
  }
}

window.classbeatRoom = { mount: mountRoom };
