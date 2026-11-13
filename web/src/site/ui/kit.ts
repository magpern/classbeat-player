// The site's building blocks (docs/design/site.md, "What every page has"): headings, text,
// buttons, fields, plates, notes and the working status. Shapes never carry meaning alone:
// each mark sits beside its words.
import { el, t, uid } from "./dom.ts";
import type { Child } from "./dom.ts";

export const h1 = (text: string): HTMLHeadingElement => {
  const h = el("h1", {}, [t("h1", text, 3)]);
  h.tabIndex = -1;
  return h;
};
export const h2 = (text: string): HTMLHeadingElement => el("h2", {}, [t("h2", text, 3)]);
export const p = (text: string): HTMLParagraphElement => el("p", {}, [t("body", text)]);
export const small = (text: string): HTMLParagraphElement => el("p", { class: "small" }, [t("small", text)]);

export interface ButtonOptions {
  readonly primary?: boolean;
  readonly full?: boolean;
  readonly quiet?: boolean;
  readonly disabled?: boolean;
  readonly submit?: boolean;
  readonly onPress?: () => void;
}

export function button(text: string, o: ButtonOptions = {}): HTMLButtonElement {
  const cls = ["btn", o.primary && "primary", o.full && "full", o.quiet && "q"].filter(Boolean).join(" ");
  const b = el("button", { class: cls }, [t("btn", text, 2)]);
  b.type = o.submit ? "submit" : "button";
  b.disabled = !!o.disabled;
  if (o.onPress) {
    const press = o.onPress;
    b.addEventListener("click", () => press());
  }
  return b;
}

export const buttons = (...list: Child[]): HTMLDivElement => el("div", { class: "btns" }, list);

export interface FieldOptions {
  readonly type: "email" | "text";
  readonly name: string;
  readonly value?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly autocomplete?: string;
  readonly placeholder?: string;
}

/** A labelled field: the label above, the hint below, the error below that (with a hollow square). */
export function field(label: string, o: FieldOptions): { readonly root: HTMLDivElement; readonly input: HTMLInputElement } {
  const id = uid(o.name);
  const input = el("input", { class: "input", id });
  input.type = o.type;
  input.name = o.name;
  input.value = o.value ?? "";
  input.spellcheck = false;
  if (o.autocomplete) input.autocomplete = o.autocomplete as AutoFill;
  if (o.placeholder) input.placeholder = o.placeholder;
  const described: string[] = [];
  const hint = o.hint ? el("span", { class: "hint", id: `${id}-hint` }, [t("small", o.hint, 3)]) : null;
  if (hint) described.push(hint.id);
  const error = o.error ? el("div", { class: "error", id: `${id}-error` }, [el("span", { class: "mark away", "aria-hidden": "true" }), t("small", o.error, 3)]) : null;
  if (error) {
    described.push(error.id);
    input.setAttribute("aria-invalid", "true");
  }
  if (described.length) input.setAttribute("aria-describedby", described.join(" "));
  const lab = el("label", { class: "lab" }, [t("flab", label, 2)]);
  lab.htmlFor = id;
  const root = el("div", { class: `field${error ? " err" : ""}` }, [lab, input, hint, error]);
  return { root, input };
}

/** A plate: white, black text, for what needs the person (a refusal, a limit, an error). */
export function plate(head: string, detail: string, ...actions: Child[]): HTMLDivElement {
  const box = el("div", { class: "plate", role: "alert" }, [
    el("div", { class: "head2" }, [el("span", { class: "mark away", "aria-hidden": "true" }), t("title", head, 3)]),
    detail ? el("p", { class: "dt" }, [t("body", detail)]) : null,
    actions.some(Boolean) ? buttons(...actions) : null,
  ]);
  box.tabIndex = -1;
  return box;
}

/** A note: outlined, for "done". */
export function note(head: string, detail = ""): HTMLDivElement {
  const box = el("div", { class: "note", role: "status" }, [
    el("div", { class: "head2" }, [el("span", { class: "mark ok", "aria-hidden": "true" }), t("title", head, 3)]),
    detail ? el("p", { class: "dt" }, [t("small", detail)]) : null,
  ]);
  box.tabIndex = -1;
  return box;
}

/** Working: a hollow circle and a sentence. Nothing turns. */
export const working = (text: string): HTMLDivElement => el("div", { class: "status", role: "status" }, [el("span", { class: "mark work", "aria-hidden": "true" }), t("body", text, 3)]);

/** The "or" between the email link and the passkey. */
export const or = (): HTMLDivElement => el("div", { class: "or" }, [t("label", "or", 1)]);
