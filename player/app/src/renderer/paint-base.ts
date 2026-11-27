// The small helpers every painter of the class list shares: an element with text, the Cmd/Ctrl
// shortcut and a key. Text only through textContent; nothing from a class becomes markup.
import type { Button } from "../core/list/states.ts";

export type Act = (id: Button["id"]) => void;

export function h(tag: string, cls: string | null, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (cls !== null) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** "Ctrl+O" is "Cmd+O" on a Mac. */
export const shortcut = (key: string): string => (navigator.platform.startsWith("Mac") ? key.replace("Ctrl", "Cmd") : key);

export function buttonEl(b: Button, act: Act): HTMLButtonElement {
  const el = h("button", b.primary ? "primary" : null) as HTMLButtonElement;
  el.type = "button";
  el.dataset.action = b.id;
  // A held key (a search runs) is shown, dashed and grey, and cannot be used.
  if (b.held === true) el.disabled = true;
  el.append(h("span", null, b.label));
  if (b.key !== null) el.append(" ", h("span", "kbd", shortcut(b.key)));
  el.addEventListener("click", () => act(b.id));
  return el;
}
