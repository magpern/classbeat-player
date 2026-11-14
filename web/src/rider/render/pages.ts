// The rider's pages without the class view (docs/design/rider.md, "States" and "Ending"): waiting
// with nothing to show yet, could not join, no connection, removed and ended. The words say nothing
// about why a join was refused (ADR 0007 sections 3 and 5). Text only ever set with textContent.
import { el } from "../../room/dom.ts";
import { RECONNECTING } from "../core/view.ts";
import { h1, pageKey, para, plate } from "./parts.ts";

const page = (lead: Node[], act: Node[]): HTMLElement => el("main", { class: "page" }, [el("div", { class: "lead" }, lead), el("div", { class: "act" }, act)]);

function codeLine(code: string): HTMLElement {
  return el("p", { class: "code-line" }, [el("span", { tier: "label" }, ["Class code ", el("span", { class: "v n", text: code })])]);
}

/** Joined, and no class to show yet: the class is not open on the instructor's computer. */
export function waitingPage(who: string, down: boolean, wake: boolean): HTMLElement {
  const work = el("div", { class: "work" }, [el("span", { tier: "minor", clamp: 1, text: who })]);
  work.setAttribute("role", "status");
  const lead: Node[] = [h1("Waiting for the instructor"), para("You are in. The class shows here when the instructor is back.", true)];
  if (down) lead.push(plate(RECONNECTING));
  lead.push(work);
  return page(lead, wake ? [] : [para("Set your screen to stay on", true)]);
}

/** cannot_join (one text for every cause), or the request could not be sent: Try again goes back to the form. */
export function refusedPage(kind: "not_joined" | "no_connection", code: string | null, retry: () => void): HTMLElement {
  const lead: Node[] =
    kind === "not_joined"
      ? [h1("Could not join"), para("Check the code with your instructor."), ...(code ? [codeLine(code)] : [])]
      : [h1("No connection"), para("Check your phone's network, then try again."), ...(code ? [codeLine(code)] : [])];
  return page(lead, [pageKey("retry", "Try again", { main: true }, retry)]);
}

/** `ended` with reason `dropped`: no rejoin key. Scanning the code again is the way back. */
export function removedPage(): HTMLElement {
  return page([h1("The instructor removed you from this class", 3), para("To join again, scan the code on the room screen.", true)], []);
}

export function endedPage(): HTMLElement {
  return page([h1("The class has ended"), para("You can close this page.", true)], []);
}
