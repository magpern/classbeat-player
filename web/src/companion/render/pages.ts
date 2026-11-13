// The pages without the class (docs/design/companion.md, "States"): getting control, connecting,
// not connected, control ended and session ended. Built with the mock-ups' words; text is only
// ever set with textContent, and a code typed in a field is never written anywhere but the field.
import { zoneClass } from "../../design/zones.ts";
import { el } from "../../room/dom.ts";
import { shownWhileTyping } from "../core/codes.ts";
import type { Entry, Field, Way } from "../core/entry.ts";
import { SENDING } from "../core/keys.ts";
import type { LostView } from "../core/view.ts";

export const WAKE_WORDS = "Set your screen to stay on";
export const SIGNED_IN_WORDS = "Signed in on this phone";
const SECOND_DISPLAY = "Second display? The presenter window shows a control code and its QR code: scan it, or type the code here.";

/** A page key: it sends no command, only moves the page (K5). */
function pageKey(action: string, label: string, o: { main?: boolean; busy?: boolean } = {}, onPress?: () => void): HTMLButtonElement {
  const b = el("button", { class: `key full${o.main ? " main" : ""}` }, [el("span", { class: "kl", tier: "minor", lines: 2, text: o.busy ? SENDING : label })]);
  b.type = "button";
  b.dataset.action = action;
  if (o.busy) b.setAttribute("aria-busy", "true");
  if (onPress) b.addEventListener("click", () => onPress());
  return b;
}

const h1 = (text: string): HTMLElement => el("h1", {}, [el("span", { tier: "value", lines: 2, text })]);
const para = (text: string, small = false): HTMLElement => el("p", small ? { class: "small" } : {}, [el("span", { tier: small ? "label" : "minor", lines: 6, text })]);
const page = (lead: Node[], act: Node[]): HTMLElement => el("main", { class: "page" }, [el("div", { class: "lead" }, lead), el("div", { class: "act" }, act)]);

function plate(head: string, detail: string): HTMLElement {
  const p = el("div", { class: "plate" }, [el("span", { class: "h", tier: "minor", lines: 2, text: head }), el("span", { class: "dt", tier: "label", lines: 4, text: detail })]);
  p.setAttribute("role", "alert");
  return p;
}

export interface EntryHandlers {
  typed(field: Field, text: string): void;
  submit(way: Way): void;
}

const FIELD_IDS: Record<Field, string> = { class: "class-code", control: "control-code" };

function field(e: Entry, f: Field, label: string, placeholder: string, h: EntryHandlers, way: Way): HTMLElement {
  const input = el("input", { class: "input", tier: "value" });
  input.id = FIELD_IDS[f];
  input.type = "text";
  input.value = f === "class" ? e.classCode : e.controlCode;
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 12;
  input.inputMode = "text";
  input.enterKeyHint = "go";
  input.setAttribute("autocapitalize", "characters");
  input.addEventListener("input", () => {
    const shown = shownWhileTyping(input.value);
    if (shown !== input.value) input.value = shown;
    h.typed(f, input.value);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      h.submit(way);
    }
  });
  const lab = el("label", { class: "lab", tier: "label", text: label });
  lab.htmlFor = input.id;
  const box = el("div", { class: `field${e.error?.field === f ? " err" : ""}` }, [lab, input]);
  if (e.error?.field === f) {
    const line = el("div", { class: "err-line" }, [el("span", { tier: "label", lines: 4, text: e.error.text })]);
    line.id = `${input.id}-error`;
    line.setAttribute("role", "alert");
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", line.id);
    box.append(line);
  }
  return box;
}

/** The "get control" page in its three forms: not signed in, signed in, and two phones already. */
export function entryPage(e: Entry, wakeWorks: boolean, h: EntryHandlers): HTMLElement {
  const wake = wakeWorks ? [] : [para(WAKE_WORDS, true)];
  const steer = (main: boolean): HTMLButtonElement => pageKey("control", "Steer this class", { main, busy: e.busy === "sign_in" }, () => h.submit("sign_in"));
  const getControl = (main: boolean): HTMLButtonElement => pageKey("control", "Get control", { main, busy: e.busy === "code" }, () => h.submit("code"));
  const classField = (way: Way): HTMLElement => field(e, "class", "Class code", "8 letters", h, way);
  if (e.full) {
    const title = h1("Two phones already steer this class");
    if (e.signedIn === true) return page([title, para("The class goes on. Drop a phone on the computer, then tap Steer this class.", true)], [classField("sign_in"), steer(true), ...wake]);
    return page([title, para("The class goes on. Drop a phone on the computer, then ask it for a new control code.", true)], [classField("code"), field(e, "control", "Control code", "New code, 8 letters", h, "code"), getControl(true), ...wake]);
  }
  const title = h1("Steer the class from this phone");
  if (e.signedIn === true) {
    const who = el("span", { class: "who", tier: "label", lines: 2, text: SIGNED_IN_WORDS });
    return page([title, who], [classField("sign_in"), steer(true), para("The class code is on the room screen. Control needs the account that runs the class.", true), ...wake]);
  }
  return page(
    [title, para("Sign in with the account that runs the class, and type the class code from the room screen.", true), classField("sign_in"), pageKey("sign_in", "Sign in to steer", { main: true }, () => h.submit("sign_in"))],
    [para(SECOND_DISPLAY, true), field(e, "control", "Control code", "8 letters", h, "code"), getControl(false), ...wake],
  );
}

export function connectingPage(cancel: () => void): HTMLElement {
  const work = el("div", { class: "work" }, [el("span", { tier: "minor", lines: 2, text: "Getting the class from the computer" })]);
  work.setAttribute("role", "status");
  return page([h1("Connecting to the class"), work], [pageKey("cancel", "Cancel", {}, cancel)]);
}

/** No class for 10 s: the phone's connection is down (it tries again), or the computer is away. */
export function lostPage(v: LostView, retry: () => void): HTMLElement {
  const head = v.phone ? plate("Not connected", "The class goes on on the computer. Trying again…") : plate("Computer not connected", "The class goes on on the computer.");
  const lead: Node[] = [head];
  if (v.zone) {
    const txt = el("div", { class: "gel-txt" }, [el("span", { class: "lbl", tier: "label", text: `Last seen ${v.lastSeen} ago` }), el("span", { class: `gel-name n${v.zone.name.length > 24 ? " long" : ""}`, tier: "value", lines: 2, clamp: 2, text: v.zone.name })]);
    lead.push(el("section", { class: `gel ${zoneClass(v.zone.number)} down` }, [el("span", { class: "gel-num n", tier: "gel", text: String(v.zone.number) }), txt]));
  }
  if (!v.phone) return page(lead, [para("Keys work again when the computer is back", true)]);
  return page(lead, [pageKey("reconnect", "Try again now", {}, retry), para("Nothing you press here reaches the class until the phone is back.", true)]);
}

export function droppedPage(again: () => void): HTMLElement {
  return page([h1("This phone no longer steers the class"), para("The computer ended its control. The class goes on.", true)], [pageKey("get_control", "Get control again", {}, again), para("Sign in again, or ask the computer for a new control code.", true)]);
}

export function endedPage(again: () => void): HTMLElement {
  return page([h1("The class session has ended"), para("There is nothing more to steer from this phone. If the class is still running, get control again.", true)], [pageKey("get_control", "Get control again", {}, again)]);
}
