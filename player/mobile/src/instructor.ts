// Instructor mode's start page, instructor.html (docs/design/app-modes.md): the mode tag, the class
// list and the mode strip. Only the InstructorMode plugin is on the bridge while this page shows.
// A class opens the room screen, room.html, which has no strip; Back there returns here.
import "../../../web/src/design/tokens.css";
import "../../../web/src/companion/companion.css";
import "../../../web/src/rider/rider.css";
import "./modes/app.css";
import { el } from "../../../web/src/room/dom.ts";
import { instructorMode } from "./modes/bridge.ts";
import { FAKE_CLASSES } from "./modes/fake-classes.ts";
import { page, h1, key, modeTag, strip } from "./modes/view.ts";
import { INSTRUCTOR } from "./modes/words.ts";

const native = instructorMode();
let asking = false;

const status = el("div", { class: "status" }, [el("span", { class: "ok", tier: "label", lines: 1, text: INSTRUCTOR.status })]);
const rows = el(
  "div",
  { class: "rows" },
  FAKE_CLASSES.map((c) =>
    key("key row", "open_class", c.title, () => window.location.assign("room.html"), [
      el("span", { class: "kl", tier: "minor", lines: 2, text: c.title }),
      el("span", { class: "kh", tier: "label", lines: 1, text: c.facts }),
    ]),
  ),
);
const s = strip(INSTRUCTOR.key, () => void ask());
document.body.append(page([modeTag(INSTRUCTOR.tag), h1(INSTRUCTOR.title), status], [rows, s.nav]));

async function ask(): Promise<void> {
  if (asking) return;
  asking = true;
  try {
    // The native question answers; a switch replaces this page, "Stay" leaves it as it was.
    await native.askRiderMode();
  } catch {
    // Refused: nothing changed.
  } finally {
    asking = false;
  }
}
