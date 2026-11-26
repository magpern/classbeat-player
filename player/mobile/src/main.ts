// The room screen's page, room.html?id=<class id>, in instructor mode only (issues #630, #871, #872):
// the desktop's room screen (the web lane's 2D screen and the player's band), bundled into the app and
// run by the shared player core (room/clock-room.ts) with the class native code saved
// (room/open-room.ts), on the manual clock until the instructor picks Follow and the clock follows the
// music on this phone (room/phone-follower.ts). The room screen's module reads `window.room` as it
// first runs, so it is loaded only once the class has opened; a class that does not open goes back to
// the list's plate. Native code is reached only through getClass and the follow intents
// (room/native.ts), never instructor mode's plugin.
import type { ClockRoom } from "./room/clock-room.ts";
import { hasMusicReader } from "./room/reader-platform.ts";
import { roomClass, roomFollow } from "./room/native.ts";
import { roomPlatform } from "./room/native.ts";
import { usePhoneLayouts } from "./room/phone-layouts.ts";
import { phoneFollower } from "./room/phone-follower.ts";
import { openRoom } from "./room/open-room.ts";

const now = (): number => performance.now();
const every = (fn: () => void, ms: number): (() => void) => {
  const timer = setInterval(fn, ms);
  return () => clearInterval(timer);
};

// Held upright, the room screen takes play.md's Portrait layout (room/phone-layouts.ts).
usePhoneLayouts(window);
void openRoom({
  search: window.location.search,
  native: roomClass(),
  now,
  every,
  follower: () => phoneFollower(roomFollow(), window, { now, every }),
  // No reader on this platform (reader-platform.ts): no follower is built, so no Follow and no native music call.
  hasReader: hasMusicReader(roomPlatform()),
  leave: () => window.location.replace("instructor.html"),
  onClose: (fn) => window.addEventListener("pagehide", fn, { once: true }),
  install: (room: ClockRoom) => {
    (window as unknown as { room: ClockRoom }).room = room;
  },
  mount: () => import("../../app/src/renderer/room.ts"),
  go: (href) => window.location.replace(href),
});
