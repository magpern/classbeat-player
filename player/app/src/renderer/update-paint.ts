// Paints the update notice and the Settings page's "Updates" part (docs/design/updates.md) from the
// words of core/update/words.ts. Text only through textContent; no link and no address anywhere:
// "Open release page" is a button, and the shell builds the address (ADR 0014 section 2).
import { NOT_KNOWN } from "../core/update/words.ts";
import type { Fact, Marker, NoticeWords, SwitchWords } from "../core/update/words.ts";
import { h } from "./list-paint.ts";

const MARKERS: readonly Marker[] = ["ok", "news", "work", "away"];

/** Sets the text only when it changed: a status region says a line again when its text is replaced. */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function paintMarker(el: Element, marker: Marker): void {
  for (const m of MARKERS) el.classList.toggle(m, m === marker);
}

/** "Open release page": no argument goes with it. */
export function openButtonEl(open: () => void): HTMLButtonElement {
  const b = h("button", "primary") as HTMLButtonElement;
  b.type = "button";
  b.dataset.action = "open-release";
  b.append(h("span", null, "Open release page"));
  b.addEventListener("click", open);
  return b;
}

/** The notice's words: the filled square, "Newer version available", the version (and its tag), the detail. */
export function noticeWhatEl(n: NoticeWords): HTMLElement {
  const what = h("div", "what");
  const mark = h("span", "mark news");
  mark.setAttribute("aria-hidden", "true");
  const l1 = h("div", "l1");
  l1.append(h("span", "st", "Newer version available"), h("span", "ver n", n.version));
  if (n.pre) l1.append(h("span", "tag", "Pre-release"));
  const words = h("div", null);
  words.append(l1, h("span", "dt", n.detail));
  what.append(mark, words);
  return what;
}

/** A version line: the version as its tag has it, "Pre-release" beside a hyphen part, or "Not known". */
export function paintFact(el: HTMLElement, f: Fact): void {
  const sig = `${f.version ?? ""}|${f.pre}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.classList.toggle("none", f.version === null);
  el.replaceChildren(h("span", null, f.version ?? NOT_KNOWN), ...(f.pre ? [h("span", "tag", "Pre-release")] : []));
}

/** A switch row: its state in words ("On", "Off"), aria-checked and its help line. */
export function paintSwitch(el: HTMLElement, w: SwitchWords): void {
  el.classList.toggle("on", w.on);
  el.setAttribute("aria-checked", String(w.on));
  const help = el.querySelector(".hp");
  const state = el.querySelector(".state");
  if (help !== null) setText(help, w.help);
  if (state !== null) setText(state, w.on ? "On" : "Off");
}
