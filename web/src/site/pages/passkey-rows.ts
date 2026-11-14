// The rows of the Passkeys page (docs/design/site.md, "Account"): a passkey, the same row as a
// rename form ("Save", "Cancel", focus in the field), and as the remove confirmation ("Keep it"
// first and focused, then "Remove passkey"). Esc on either cancels. Names are the person's own
// text, set as text only.
import { NAME_ERROR } from "../core/pairing-model.ts";
import { dayWords, lastUsedWords } from "../core/devices-model.ts";
import type { Day } from "../core/devices-model.ts";
import { PASSKEY_WORDS } from "../core/passkeys-model.ts";
import type { Passkey } from "../core/passkeys-model.ts";
import { dayOf } from "../ui/day.ts";
import { el, t, uid } from "../ui/dom.ts";
import { button, field } from "../ui/kit.ts";

export interface RowActions {
  readonly rename: (k: Passkey) => void;
  readonly remove: (k: Passkey) => void;
}

/** A button of a row, found again by `[data-row="<id>"][data-act="rename|remove"]`. */
function rowButton(text: string, k: Passkey, act: "rename" | "remove", onPress: () => void, o: { primary?: boolean } = {}): HTMLButtonElement {
  const b = button(text, { primary: o.primary, onPress });
  b.dataset.row = k.id;
  b.dataset.act = act;
  return b;
}

const onEscape = (box: HTMLElement, cancel: () => void): void => {
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    cancel();
  });
};

export function passkeyRow(k: Passkey, now: Day, act: RowActions): HTMLElement {
  const added = dayOf(k.addedAt) as Day;
  const used = k.lastUsedAt === null ? null : dayOf(k.lastUsedAt);
  const meta = el("div", { class: "ac-m" }, [PASSKEY_WORDS.addedOn(dayWords(added, now)), lastUsedWords(used, now)].map((w) => el("span", {}, [t("small", w, 3)])));
  return el("div", { class: "ac-item" }, [
    el("div", {}, [el("div", { class: "ac-t" }, [t("title", k.name, 3)]), meta]),
    el("div", { class: "ac-acts" }, [rowButton(PASSKEY_WORDS.rename, k, "rename", () => act.rename(k)), rowButton(PASSKEY_WORDS.remove, k, "remove", () => act.remove(k))]),
  ]);
}

export interface RenameRow {
  readonly typed: string;
  readonly nameError: boolean;
  readonly busy: boolean;
}

/** The row as a rename form. Enter saves; nothing is sent until then. */
export function renameRow(k: Passkey, v: RenameRow, save: (typed: string) => void, cancel: () => void): HTMLElement {
  const f = field(PASSKEY_WORDS.renameLabel, { type: "text", name: "name", value: v.typed, hint: v.nameError ? undefined : PASSKEY_WORDS.renameHint, error: v.nameError ? NAME_ERROR : undefined });
  f.input.autocomplete = "off";
  f.input.readOnly = v.busy;
  const ok = button(PASSKEY_WORDS.save, { primary: true, submit: true, disabled: v.busy });
  const no = button(PASSKEY_WORDS.cancel, { disabled: v.busy, onPress: cancel });
  const form = el("form", { class: "ac-item ac-edit" }, [el("div", {}, [f.root]), el("div", { class: "ac-acts" }, [ok, no])]);
  form.dataset.row = k.id;
  form.noValidate = true;
  form.method = "post";
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    save(f.input.value);
  });
  onEscape(form, cancel);
  return form;
}

/** The row as the remove confirmation: the consequence, "Keep it" (the default) and "Remove passkey". */
export function removeRow(k: Passkey, busy: boolean, keep: () => void, remove: () => void): HTMLElement {
  const head = el("div", { class: "ac-t", id: uid("remove") }, [t("title", PASSKEY_WORDS.removeAsk(k.name), 3)]);
  const said = el("div", { class: "ac-m", id: uid("remove-said") }, [el("span", {}, [t("small", PASSKEY_WORDS.removeConsequence, 4)])]);
  const kept = button(PASSKEY_WORDS.keep, { primary: true, disabled: busy, onPress: keep });
  kept.dataset.keep = "";
  const gone = button(PASSKEY_WORDS.removeButton, { disabled: busy, onPress: remove });
  const box = el("div", { class: "ac-item ac-panel panel", role: "alertdialog", "aria-labelledby": head.id, "aria-describedby": said.id }, [el("div", {}, [head, said]), el("div", { class: "ac-acts" }, [kept, gone])]);
  onEscape(box, keep);
  return box;
}

export interface AddPanel {
  readonly typed: string;
  readonly nameError: boolean;
  readonly busy: boolean;
}

/** The add form: a name, "Add passkey" and "Cancel". The browser's prompt follows "Add passkey". */
export function addPanel(v: AddPanel, add: (typed: string) => void, cancel: () => void, waiting: Node | null): HTMLElement {
  const head = el("h2", { id: uid("add") }, [t("h2", PASSKEY_WORDS.addPanel, 3)]);
  const f = field(PASSKEY_WORDS.nameLabel, { type: "text", name: "name", value: v.typed, hint: v.nameError ? undefined : PASSKEY_WORDS.nameHint, error: v.nameError ? NAME_ERROR : undefined });
  f.input.autocomplete = "off";
  f.input.readOnly = v.busy;
  const ok = button(PASSKEY_WORDS.addButton, { primary: true, full: true, submit: true, disabled: v.busy });
  const no = button(PASSKEY_WORDS.cancel, { full: true, disabled: v.busy, onPress: cancel });
  const actions = el("div", { class: "btns" }, [ok, no]);
  const form = el("form", { class: "ac-panel panel", "aria-labelledby": head.id }, [head, f.root, waiting, actions]);
  form.dataset.add = "";
  form.noValidate = true;
  form.method = "post";
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    add(f.input.value);
  });
  onEscape(form, cancel);
  return form;
}
