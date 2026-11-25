// Paints the Swedebeat line, its plate and the sign-in form on the class list page
// (docs/design/swedebeat.md, core/mix/list-model.ts). Text only through textContent. The form's
// fields are real inputs that are never filled from anything the shell sent: what is typed is read
// once on Connect, the fields are emptied at once, and it goes to the shell in that one call.
import type { MixForm, MixLine, MixPlate } from "../core/mix/list-model.ts";
import { MAX_FIELD_CHARS } from "../core/mix/sign-in-input.ts";
import { buttonEl, h } from "./list-paint.ts";
import type { Act } from "./list-paint.ts";

export function mixLineEl(l: MixLine, act: Act): HTMLElement {
  const box = h("div", "status sw");
  const what = h("div", "what");
  const mark = h("span", `mark ${l.marker}`);
  mark.setAttribute("aria-hidden", "true");
  const words = h("div", null);
  words.append(h("span", "st", l.text), h("span", "dt", l.detail));
  what.append(mark, words);
  box.append(what);
  if (l.button !== null) box.append(buttonEl(l.button, act));
  return box;
}

export function mixPlateEl(p: MixPlate, act: Act): HTMLElement {
  const box = h("div", "plate second");
  box.setAttribute("role", "alert");
  const words = h("div", null);
  words.append(h("span", "st", p.headline), h("span", "dt", p.detail));
  box.append(words);
  if (p.buttons.length > 0) {
    const row = h("div", "row-btns");
    for (const b of p.buttons) row.append(buttonEl(b, act));
    box.append(row);
  }
  return box;
}

function fieldTemplate(): HTMLInputElement {
  const t = document.getElementById("mix-field") as HTMLTemplateElement | null;
  const input = t?.content.firstElementChild?.cloneNode(true);
  if (!(input instanceof HTMLInputElement)) throw new Error("mix-field template missing");
  return input;
}

/** The form, in place of the list. Enter in a field is Connect. */
export function mixFormEl(f: MixForm, act: Act): HTMLElement {
  const box = h("section", "panel");
  box.dataset.panel = "mix-form";
  box.append(h("h2", "n", f.heading));
  if (f.text !== null) box.append(h("p", null, f.text));
  const fields = h("div", "fields");
  for (const field of f.fields) {
    const label = h("label", "field-box");
    // The template (classlist.html) sets what the browser must not keep, suggest or check.
    const input = fieldTemplate();
    input.dataset.field = field.id;
    // Dots while typed for a secret.
    input.type = field.secret ? "password" : "text";
    input.maxLength = MAX_FIELD_CHARS;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        act("mix-submit");
      }
    });
    label.append(h("span", "lbl", field.label), input);
    fields.append(label);
  }
  box.append(fields);
  const row = h("div", "row-btns");
  for (const b of f.buttons) row.append(buttonEl(b, act));
  box.append(row);
  if (f.fine !== null) box.append(h("p", "fine", f.fine));
  return box;
}

/** What was typed, by field name; every field is emptied before this returns. */
export function takeTyped(root: HTMLElement): Record<string, string> {
  const typed: Record<string, string> = {};
  for (const input of root.querySelectorAll<HTMLInputElement>("input[data-field]")) {
    const name = input.dataset.field;
    if (name !== undefined) typed[name] = input.value;
    input.value = "";
  }
  return typed;
}

/** The ids of the fields left empty; reads only whether each is empty, never a value. */
export function emptyFields(root: HTMLElement): Set<string> {
  const empty = new Set<string>();
  for (const input of root.querySelectorAll<HTMLInputElement>("input[data-field]")) {
    if (input.dataset.field !== undefined && input.value.length === 0) empty.add(input.dataset.field);
  }
  return empty;
}

/** Empties every field without reading it (Cancel, Esc). */
export function clearTyped(root: HTMLElement): void {
  for (const input of root.querySelectorAll<HTMLInputElement>("input[data-field]")) input.value = "";
}
