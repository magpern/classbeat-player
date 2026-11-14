// The join form and the My numbers sheet (docs/design/rider.md, "Getting in", "Before and while
// joining" and "The one key and the keyboard"). Text is only ever set with textContent and a typed
// value only ever lives in its field: nothing the rider types becomes markup.
import { el } from "../../room/dom.ts";
import { shownWhileTyping } from "../../companion/core/codes.ts";
import type { FieldName, Form } from "../core/join.ts";
import { PLATE_WORDS } from "../core/join.ts";
import { NICKNAME_MAX } from "../core/fields.ts";
import { h1, pageKey, para, plate } from "./parts.ts";

export const PRIVACY = "Your instructor sees your nickname. FTP and max heart rate stay on this phone and are never sent.";
export const NO_STORAGE = "Not available on this phone";

export interface FormHandlers {
  typed(field: FieldName, text: string): void;
  join(): void;
  remember(): void;
  forget(): void;
  done(): void;
}

interface FieldSpec {
  readonly label: string;
  readonly placeholder: string;
  readonly numeric: boolean;
}

const SPECS: Readonly<Record<FieldName, FieldSpec>> = {
  code: { label: "Class code", placeholder: "8 letters", numeric: false },
  nickname: { label: "Nickname", placeholder: "1 to 24 characters", numeric: false },
  ftp: { label: "FTP, in watts (optional)", placeholder: "e.g. 250", numeric: true },
  hrmax: { label: "Max heart rate, in bpm (optional)", placeholder: "e.g. 185", numeric: true },
};

function field(f: Form, name: FieldName, h: FormHandlers, enter: () => void): HTMLElement {
  const spec = SPECS[name];
  const input = el("input", { class: `input${name === "code" ? "" : " plain"}`, tier: "value" });
  input.id = `rider-${name}`;
  input.type = "text";
  input.value = f.typed[name];
  input.placeholder = spec.placeholder;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.enterKeyHint = "go";
  if (spec.numeric) {
    input.inputMode = "numeric";
    input.maxLength = 4;
  } else if (name === "code") {
    input.maxLength = 12;
    input.setAttribute("autocapitalize", "characters");
  } else {
    // Room for spaces the page trims; the length is checked in code points on Join.
    input.maxLength = NICKNAME_MAX * 4;
    input.setAttribute("autocapitalize", "words");
  }
  if (f.busy) input.readOnly = true;
  input.addEventListener("input", () => {
    if (name === "code") {
      const shown = shownWhileTyping(input.value);
      if (shown !== input.value) input.value = shown;
    }
    h.typed(name, input.value);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      enter();
    }
  });
  const lab = el("label", { class: "lab", tier: "label", lines: 2, text: spec.label });
  lab.htmlFor = input.id;
  const error = f.errors[name];
  const box = el("div", { class: `field${error ? " err" : ""}${f.busy ? " dim" : ""}` }, [lab, input]);
  if (error) {
    const line = el("div", { class: "err-line" }, [el("span", { tier: "label", lines: 4, text: error })]);
    line.id = `${input.id}-error`;
    line.setAttribute("role", "alert");
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", line.id);
    box.append(line);
  }
  return box;
}

/** The switch says its state in words, "On" or "Off", never by colour alone. */
function rememberSwitch(f: Form, h: FormHandlers): HTMLElement[] {
  const usable = f.storage && !f.busy;
  const b = el("button", { class: `key sw${f.remember && f.storage ? " on" : ""}${usable ? "" : " dis"}` }, [
    el("span", { class: "kl", tier: "minor", lines: 2, text: "Remember on this phone" }),
    el("span", { class: "st", tier: "minor", text: f.remember && f.storage ? "On" : "Off" }),
  ]);
  b.type = "button";
  b.dataset.action = "remember";
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", String(f.remember && f.storage));
  if (!usable) b.setAttribute("aria-disabled", "true");
  else b.addEventListener("click", () => h.remember());
  return f.storage ? [b] : [b, para(NO_STORAGE, true)];
}

function pair(f: Form, h: FormHandlers, enter: () => void): HTMLElement {
  return el("div", { class: "pair" }, [field(f, "ftp", h, enter), field(f, "hrmax", h, enter)]);
}

/** Forget (only while something is remembered) beside the main key. */
function duo(f: Form, main: HTMLButtonElement, h: FormHandlers): HTMLElement {
  if (!f.remembered || f.busy) return el("div", { class: "duo solo" }, [main]);
  return el("div", { class: "duo" }, [pageKey("forget", "Forget", {}, () => h.forget()), main]);
}

function codeLine(code: string): HTMLElement {
  return el("p", { class: "code-line" }, [el("span", { tier: "label" }, ["Class code ", el("span", { class: "v n", text: code })])]);
}

const page = (lead: Node[], act: Node[]): HTMLElement => el("main", { class: "page form" }, [el("div", { class: "lead" }, lead), el("div", { class: "act" }, act)]);

/** The join form: plain, remembered, with errors, with no code, with a plate, and while joining. */
export function joinPage(f: Form, h: FormHandlers): HTMLElement {
  const enter = (): void => h.join();
  const lead: Node[] = [];
  if (f.busy) {
    const work = el("div", { class: "work" }, [el("span", { tier: "minor", lines: 2, text: "Getting you into the class" })]);
    work.setAttribute("role", "status");
    lead.push(h1("Joining the class"), ...(f.code ? [codeLine(f.code)] : []), work);
  } else {
    lead.push(h1("Join the class"));
    lead.push(f.code ? codeLine(f.code) : para("Type the class code from the room screen.", true));
    if (f.plate) lead.push(plate(...PLATE_WORDS[f.plate]));
    lead.push(para(PRIVACY, true));
  }
  const fields: Node[] = [];
  if (!f.code) fields.push(field(f, "code", h, enter));
  fields.push(field(f, "nickname", h, enter), pair(f, h, enter), ...rememberSwitch(f, h));
  const main = pageKey("join", f.busy ? "Joining…" : "Join the class", { main: !f.busy, dis: f.busy }, f.busy ? undefined : enter);
  return page(lead, [...fields, duo(f, main, h)]);
}

/** My numbers: the two number fields, Remember and Forget over the view; Done closes it. Nothing is sent. */
export function numbersSheet(f: Form, h: FormHandlers): HTMLElement {
  const done = (): void => h.done();
  const main = pageKey("done", "Done", { main: true }, done);
  return page([h1("My numbers"), para("Used on this phone to work out your effort. Never sent.", true)], [pair(f, h, done), ...rememberSwitch(f, h), duo(f, main, h)]);
}
