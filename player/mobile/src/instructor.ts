// Instructor mode's start page, instructor.html (docs/design/app-modes.md): the mode tag, the class
// list and the mode strip. Only the InstructorMode plugin is on the bridge while this page shows.
// The list is the one native code keeps (issue #631): it holds the device token and makes every
// backend call; the page only asks by intent. A class opens the room screen, room.html, which is
// still on fakes (fake-room.ts); Back there returns here.
import "../../../web/src/design/tokens.css";
import "../../../web/src/companion/companion.css";
import "../../../web/src/rider/rider.css";
import "./modes/app.css";
import { el } from "../../../web/src/room/dom.ts";
import { instructorMode } from "./modes/bridge.ts";
import { type ClassList, PAIR_AGAIN, parseClassList, STATUS_WORDS, UNPAIR } from "./modes/classes.ts";
import { page, h1, key, modeTag, plate, strip } from "./modes/view.ts";
import { INSTRUCTOR } from "./modes/words.ts";

const native = instructorMode();
let busy = false;

const line = el("span", { class: "ok", tier: "label", lines: 2, text: STATUS_WORDS.syncing.line });
const status = el("div", { class: "status" }, [line]);
status.setAttribute("role", "status");
const rows = el("div", { class: "rows" }, []);
const unpairKey = key("key full", "unpair", UNPAIR, () => void once(() => native.unpair()));
let shownPlate: HTMLElement | null = null;
const s = strip(INSTRUCTOR.key, () => void once(() => native.askRiderMode()));
document.body.append(page([modeTag(INSTRUCTOR.tag), h1(INSTRUCTOR.title), status], [rows, unpairKey, s.nav]));

// The saved list at once, then a sync now; each answer replaces the list.
void native.listClasses().then(show, () => undefined).then(() => native.syncNow().then(show, () => undefined));

function show(reply: unknown): void {
  const list = parseClassList(reply);
  if (list === null) return;
  render(list);
}

function render(list: ClassList): void {
  const words = STATUS_WORDS[list.status];
  line.textContent = words.line;
  shownPlate?.remove();
  shownPlate = null;
  if (words.plate !== undefined) {
    shownPlate = plate(words.line, words.plate);
    if (list.status === "expired") {
      // The question "Pair again" opens is native; on success the page is reloaded with the list.
      shownPlate.append(key("key", "pair_again", PAIR_AGAIN, () => void once(() => native.pairAgain())));
    }
    status.after(shownPlate);
  }
  rows.replaceChildren(
    ...list.classes.map((c) =>
      key("key row", "open_class", c.title, () => window.location.assign("room.html"), [
        el("span", { class: "kl", tier: "minor", lines: 2, text: c.title }),
        el("span", { class: "kh", tier: "label", lines: 1, text: c.facts }),
      ]),
    ),
  );
}

/** One native question at a time: a switch replaces this page, any other end leaves it as it was. */
async function once(ask: () => Promise<unknown>): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await ask();
  } catch {
    // Refused: nothing changed.
  } finally {
    busy = false;
  }
  // After pairing again the list is read anew.
  void native.listClasses().then(show, () => undefined);
}
