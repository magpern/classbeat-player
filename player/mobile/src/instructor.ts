// Instructor mode's start page, instructor.html (docs/design/app-modes.md): the mode tag, the class
// list and the mode strip. Only the InstructorMode plugin is on the bridge while this page shows.
// The list is the one native code keeps (issue #631): it holds the device token and makes every
// backend call; the page only asks by intent. A class opens the room screen with its id,
// room.html?id=<id> (issue #871); End and Back there return here. A class that did not open comes
// back here with a closed name in the fragment, and its plate shows above the list (room/plate-words.ts).
import "../../../web/src/design/tokens.css";
import "../../../web/src/companion/companion.css";
import "../../../web/src/rider/rider.css";
import "./modes/app.css";
import { el } from "../../../web/src/room/dom.ts";
import { instructorMode, platformName } from "./modes/bridge.ts";
import { buildSetting, refused, swedebeatOff } from "./swedebeat-off.ts";
import { swedebeatLine, swedebeatRow } from "./modes/swedebeat-view.ts";
import { type ClassList, PAIR_AGAIN, parseClassList, STATUS_WORDS, UNPAIR } from "./modes/classes.ts";
import { page, h1, key, modeTag, plate, strip } from "./modes/view.ts";
import { INSTRUCTOR } from "./modes/words.ts";
import { roomFor } from "./room/address.ts";
import { plateFor } from "./room/plate-words.ts";

const native = instructorMode();
let busy = false;

const line = el("span", { class: "ok", tier: "label", lines: 2, text: STATUS_WORDS.syncing.line });
line.setAttribute("role", "status");
// "Unpair this phone" sits on the status row, small and plain, so it costs the list no height and
// never reads as a class. It only asks: the native "Unpair this phone?" question decides.
const unpairKey = key("key quiet", "unpair", UNPAIR, () => void once(() => native.unpair()));
const status = el("div", { class: "status" }, [line, unpairKey]);
const rows = el("div", { class: "rows" }, []);
let shownPlate: HTMLElement | null = null;
const s = strip(INSTRUCTOR.key, () => void once(() => native.askRiderMode()));
// The iOS app with Swedebeat off (issue #932): the dimmed line under the sync status, always, and
// a class from Swedebeat listed but never opened. Any other build is unchanged.
const off = swedebeatOff(platformName(), buildSetting());
const swedebeat = off ? [swedebeatLine()] : [];
document.body.append(page([modeTag(INSTRUCTOR.tag), h1(INSTRUCTOR.title), status, ...swedebeat], [rows, s.nav]));

// The class that did not open, once: the fragment goes, so a reload shows the list alone.
const notOpened = plateFor(window.location.hash);
if (notOpened !== null) {
  status.after(plate(notOpened.head, notOpened.detail));
  history.replaceState(null, "", window.location.pathname);
}

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
  // A plate carries the same words as its head, so the line steps aside and the plate stands alone.
  line.hidden = words.plate !== undefined;
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
      refused(off, c.source) ? swedebeatRow(c) : key("key row", "open_class", c.title, () => window.location.assign(roomFor(c.id)), [
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
