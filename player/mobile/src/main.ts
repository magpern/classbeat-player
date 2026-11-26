// The room screen's page, room.html?id=<class id>, in instructor mode only (issues #630, #871): the
// desktop's room screen (the web lane's 2D screen and the player's band), bundled into the app and
// run by the shared player core on the manual clock (room/clock-room.ts) with the class native code
// saved (room/open-room.ts). The room screen's module reads `window.room` as it first runs, so it is
// loaded only once the class has opened; a class that does not open goes back to the list's plate.
// Native code is reached only through getClass (room/native.ts), never instructor mode's plugin.
import type { ClockRoom } from "./room/clock-room.ts";
import { roomClass } from "./room/native.ts";
import { usePhoneLayouts } from "./room/phone-layouts.ts";
import { openRoom } from "./room/open-room.ts";

// Held upright, the room screen takes play.md's Portrait layout (room/phone-layouts.ts).
usePhoneLayouts(window);
void openRoom({
  search: window.location.search,
  native: roomClass(),
  now: () => performance.now(),
  every: (fn, ms) => {
    const timer = setInterval(fn, ms);
    return () => clearInterval(timer);
  },
  leave: () => window.location.replace("instructor.html"),
  onClose: (fn) => window.addEventListener("pagehide", fn, { once: true }),
  install: (room: ClockRoom) => {
    (window as unknown as { room: ClockRoom }).room = room;
  },
  mount: () => import("../../app/src/renderer/room.ts"),
  go: (href) => window.location.replace(href),
});
