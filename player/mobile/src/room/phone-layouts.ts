// The phone's room screen held upright gets play.md's Portrait layout (issue #871): /play's grid and
// tokens (web/src/play/play-room.css, scoped to `.play`), the band laid over its score's box
// (room-portrait.css), and the three-minute score and /play's text fitting (phone-scale.ts). `.play`
// and the scale are there only while the viewport is portrait, so a phone on its side keeps the room
// screen exactly as it was. The room screen's module (player/app/src/renderer/room.ts) is the
// desktop's, unchanged: the page hands it the options by wrapping the screen's mount before it runs.
import "../../../../web/src/main.ts";
import "../../../../web/src/play/play-room.css";
import "./room-portrait.css";
import "./follow-band.css";
import type { RoomOptions, RoomScreen } from "../../../../web/src/room/mount.ts";
import { phoneRoomOptions, PORTRAIT, type Viewport } from "./phone-scale.ts";

export interface LayoutWindow extends Viewport {
  readonly document: { readonly body: { readonly classList: { toggle(name: string, on: boolean): unknown } } };
  matchMedia(query: string): { readonly matches: boolean; addEventListener(type: "change", fn: () => void): void };
  classbeatRoom: { mount(host: HTMLElement, opts?: RoomOptions): RoomScreen };
}

/** Turns `.play` on while [win] is portrait, and has the room screen take the phone's options. */
export function usePhoneLayouts(win: LayoutWindow): void {
  const portrait = win.matchMedia(PORTRAIT);
  const apply = (): void => void win.document.body.classList.toggle("play", portrait.matches);
  apply();
  portrait.addEventListener("change", apply);
  const mount = win.classbeatRoom.mount;
  win.classbeatRoom = { mount: (host, opts) => mount(host, phoneRoomOptions(opts, win)) };
}
