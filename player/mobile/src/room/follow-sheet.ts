// The follow sheet's page (docs/design/app-follow.md, "The sheet" and "Back from the setting, still
// off"): why Notification access is asked for, what is read, and two keys. Fixed words only, built
// with text nodes. While it shows, its taps and keys stay on it: the room screen's band behind it
// listens on the document and the window, and must not take a press meant for the sheet. Escape and
// Android's Back (the history entry pushed as it opens) are "Not now".
import "./follow-sheet.css";
import type { SheetControl, SheetKind } from "./follow-ask.ts";

export interface FollowSheetActions {
  openSetting(): void;
  notNow(): void;
}

const ASK_LEAD = "When a song starts, pauses or moves on, the class clock goes with it.";
const ASK_SMALL = "Only Notification access lets an app see what Spotify plays. The player reads Spotify's song, play or pause and position only: no other notification, no message.";
const STEPS = ["Open the setting", "Find classbeat in the list and turn it on", "If Android says restricted: App info for classbeat, three dots, Allow restricted settings"] as const;
const TITLES: Readonly<Record<SheetKind, string>> = { ask: "Follow the music on this phone", "still-off": "Notification access is still off" };

const el = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string | null, text: string | null = null): HTMLElementTagNameMap[K] => {
  const e = doc.createElement(tag);
  if (cls !== null) e.className = cls;
  if (text !== null) e.textContent = text;
  return e;
};

function key(doc: Document, cls: string, action: string, words: string): HTMLButtonElement {
  const b = el(doc, "button", cls);
  b.type = "button";
  b.dataset["action"] = action;
  b.append(el(doc, "span", "kl", words));
  return b;
}

function lead(doc: Document, kind: SheetKind): HTMLElement {
  const d = el(doc, "div", "lead");
  d.append(el(doc, "p", "mode", "Instructor mode"), el(doc, "h1", null, TITLES[kind]));
  if (kind === "ask") {
    d.append(el(doc, "p", null, ASK_LEAD), el(doc, "p", "small", ASK_SMALL));
    return d;
  }
  const ol = el(doc, "ol", "steps");
  STEPS.forEach((words, i) => {
    const li = el(doc, "li", null);
    li.append(el(doc, "span", "sn", String(i + 1)), el(doc, "span", "st", words));
    ol.append(li);
  });
  d.append(ol);
  return d;
}

/** The sheet, mounted hidden in [win]'s body; [act] gets its two keys, Escape and Back. */
export function mountFollowSheet(win: Window, act: FollowSheetActions): SheetControl {
  const doc = win.document;
  const sheet = el(doc, "main", "follow-sheet page");
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  doc.body.append(sheet);
  /** True while this sheet's own history entry is the current one. */
  let pushed = false;
  const open = (): boolean => !sheet.hidden;

  // The band behind listens on the document (capture) and the window, so the sheet takes every tap
  // and key at the window, before anything else sees it, and acts on its own keys from there.
  const keep = (e: Event): void => {
    if (!open()) return;
    e.stopImmediatePropagation();
    if (e.type === "click") {
      const target = e.target instanceof Element ? e.target.closest("button") : null;
      const action = target !== null && sheet.contains(target) ? target.dataset["action"] : undefined;
      if (action === "open_setting") act.openSetting();
      else if (action === "not_now") act.notNow();
      return;
    }
    if (e.type !== "keydown") return;
    const k = (e as KeyboardEvent).key;
    if (k === "Escape") {
      e.preventDefault();
      act.notNow();
    } else if (k !== "Enter" && k !== " " && k !== "Tab") e.preventDefault();
  };
  for (const type of ["pointerdown", "pointerup", "click", "keydown", "keyup"]) win.addEventListener(type, keep, { capture: true });
  win.addEventListener("popstate", () => {
    if (!pushed) return;
    pushed = false;
    if (open()) act.notNow();
  });

  return {
    show(kind) {
      const act2 = el(doc, "div", "act");
      const stack = el(doc, "div", "stack");
      stack.append(key(doc, "key main", "open_setting", "Open the setting"), key(doc, "key", "not_now", "Not now: manual clock"));
      act2.append(stack);
      sheet.replaceChildren(lead(doc, kind), act2);
      sheet.setAttribute("aria-label", TITLES[kind]);
      if (!open()) {
        sheet.hidden = false;
        if (!pushed) {
          win.history.pushState({ followSheet: true }, "");
          pushed = true;
        }
      }
      stack.querySelector("button")?.focus();
    },
    hide() {
      if (!open()) return;
      sheet.hidden = true;
      sheet.replaceChildren();
      // Closed by a key or by access given: the history entry the sheet pushed goes too.
      if (pushed) {
        pushed = false;
        win.history.back();
      }
    },
    isOpen: open,
  };
}
