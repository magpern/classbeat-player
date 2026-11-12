// The page that runs the room screen on a recorded snapshot, for CI's checks and screenshots and
// for looking at it by hand: harness.html?fixture=running[&freeze=1][&steady=1][&reduced=1].
//   freeze=1   nothing moves: no score motion, no beat flashing, no transitions (screenshots)
//   steady=1   the score and the beat dot stand still; CSS transitions stay as they are
//   reduced=1  the player's own reduced-motion setting
import "./design/tokens.css";
import "./room/room.css";
import { FIXTURES } from "./fixtures/index.ts";
import { mountRoom } from "./room/mount.ts";

const params = new URLSearchParams(location.search);
const name = params.get("fixture") ?? "running";
const input = FIXTURES[name];
const freeze = params.get("freeze") === "1";

if (freeze) document.documentElement.dataset.freeze = "";
const screen = mountRoom(document.body, {
  animate: !freeze && params.get("steady") !== "1",
  reducedMotion: params.get("reduced") === "1" ? true : undefined,
});
if (input) screen.update(input);
document.documentElement.dataset.fixture = input ? name : "unknown";

// For the motion tests: draw another snapshot on the same screen, as the shell does each second.
declare global {
  interface Window {
    harness: { show(fixture: string): void };
  }
}
window.harness = {
  show(fixture) {
    const next = FIXTURES[fixture];
    if (next) screen.update(next);
  },
};
