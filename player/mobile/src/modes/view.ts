// The pieces both modes' start pages share (docs/design/app-modes.md): the page frame, the mode tag
// and the mode strip, built as the rider page's pages (rider.md) with the mock-up's app.css.
import { el } from "../../../../web/src/room/dom.ts";

export const h1 = (text: string): HTMLElement => el("h1", {}, [el("span", { tier: "value", lines: 2, text })]);

export const para = (text: string): HTMLElement => el("p", { class: "small" }, [el("span", { tier: "label", lines: 6, text })]);

/** The mode tag: which mode the app is in, in words, first on the page. */
export const modeTag = (name: string): HTMLElement => el("p", { class: "mode" }, [el("span", { tier: "label", lines: 1, text: name })]);

export function plate(head: string, detail: string): HTMLElement {
  const p = el("div", { class: "plate" }, [el("span", { class: "h", tier: "minor", lines: 2, text: head })]);
  if (detail !== "") p.append(el("span", { class: "dt", tier: "label", lines: 4, text: detail }));
  p.setAttribute("role", "alert");
  return p;
}

/** A full-width key; [children] replace the one label when given (a class row). */
export function key(cls: string, action: string, label: string, onPress: () => void, children?: readonly HTMLElement[]): HTMLButtonElement {
  const b = el("button", { class: cls }, children ?? [el("span", { class: "kl", tier: "minor", lines: 2, text: label })]);
  b.type = "button";
  b.dataset.action = action;
  b.addEventListener("click", () => onPress());
  return b;
}

/** The mode strip, last on a start page: an optional grey lead line and the key to the other mode. */
export function strip(label: string, onPress: () => void): { nav: HTMLElement; lead: HTMLElement; key: HTMLButtonElement } {
  const lead = el("span", { class: "sl", tier: "label", lines: 3 });
  lead.hidden = true;
  const k = key("key full", "switch_mode", label, onPress);
  const nav = el("nav", { class: "strip" }, [lead, k]);
  nav.setAttribute("aria-label", "Mode");
  return { nav, lead, key: k };
}

/** The page: the lead column (tag, title, text) and the act column (content, keys, strip). */
export function page(lead: readonly HTMLElement[], act: readonly HTMLElement[], cls = "page"): HTMLElement {
  return el("main", { class: cls }, [el("div", { class: "lead" }, [...lead]), el("div", { class: "act" }, [...act])]);
}
