// Rider mode's start page, rider.html (docs/design/app-modes.md): the mode tag, the start of the
// join and the mode strip. Only the RiderMode plugin is on the bridge while this page shows. The
// class code field and the rest of the join are issue #633's.
import "../../../web/src/design/tokens.css";
import "../../../web/src/companion/companion.css";
import "../../../web/src/rider/rider.css";
import "./modes/app.css";
import { riderMode } from "./modes/bridge.ts";
import { page, h1, modeTag, para, plate, strip } from "./modes/view.ts";
import { parseAnswer, parseWay, RIDER } from "./modes/words.ts";

const native = riderMode();
const lead = [modeTag(RIDER.tag), h1(RIDER.title), para(RIDER.hint)];
let shownPlate: HTMLElement | null = null;
let asking = false;

const s = strip(RIDER.key, () => void ask());
document.body.append(page(lead, [s.nav], "page form"));

native.instructorWay().then(
  (reply) => {
    s.lead.textContent = RIDER.lead[parseWay(reply)];
    s.lead.hidden = false;
  },
  () => undefined,
);

async function ask(): Promise<void> {
  if (asking) return;
  asking = true;
  dropPlate();
  try {
    // A switch replaces this page; any other end leaves rider mode as it was.
    if (parseAnswer(await native.askInstructorMode()) === "notConfirmed") showPlate();
  } catch {
    // Refused: nothing changed.
  } finally {
    asking = false;
  }
}

function showPlate(): void {
  shownPlate = plate(RIDER.notConfirmed.head, RIDER.notConfirmed.detail);
  lead[1]?.after(shownPlate);
}

// The plate goes when the user types or presses anything (app-modes.md, "States").
function dropPlate(): void {
  shownPlate?.remove();
  shownPlate = null;
}
for (const type of ["keydown", "pointerdown"]) document.addEventListener(type, dropPlate, { capture: true });
