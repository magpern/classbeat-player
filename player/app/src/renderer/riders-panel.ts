// The presenter's riders panel (riders-panel.md; ADR 0007 sections 3 and 4): the count, the
// nicknames in the order they joined, Remove, Lock joining and New code. It only ever holds a
// RidersView (core/live/riders-view.ts). A nickname is text only (textContent, `dir="auto"`): no
// number, no time, no colour and no figure per rider, and rows are never sorted or numbered. The
// drawer opens and closes on the instructor's press only. This panel is the presenter window's
// alone; the room window has no part of it.
import type { LivePanelView } from "../core/live/panel-view.ts";
import { RIDERS_EMPTY, RIDERS_NOTE } from "../core/live/riders-view.ts";
import type { RiderRow, RidersView } from "../core/live/riders-view.ts";

export interface RidersApi {
  riders(): Promise<RidersView | null>;
  dropRider(rider: string): Promise<RidersView | null>;
  lockJoining(locked: boolean): Promise<RidersView | null>;
  newJoinCode(): Promise<RidersView | null>;
  startLive(): Promise<LivePanelView | null>;
}

const REFRESH_MS = 500;
/** No answer to "Remove … from the class?" in this long is Keep. */
export const ASK_REMOVE_MS = 5000;
/** No answer to "Make a new code?" in this long is Cancel. */
export const ASK_CODE_MS = 8000;

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};
const text = (el: HTMLElement, t: string): void => {
  if (el.textContent !== t) el.textContent = t;
};
const shown = (id: string, t: string | null): void => {
  const el = $(id);
  el.hidden = t === null;
  text(el, t ?? "");
};

interface Ui {
  open: boolean;
  /** The rider whose row asks, and when it stops asking. */
  asking: { id: string; timer: ReturnType<typeof setTimeout> } | null;
  askingCode: ReturnType<typeof setTimeout> | null;
  last: RidersView | null;
}

const ui: Ui = { open: false, asking: null, askingCode: null, last: null };

function button(label: string, aria: string | null, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (aria !== null) b.setAttribute("aria-label", aria);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function rowOf(r: RiderRow, v: RidersView, api: RidersApi): HTMLLIElement {
  const li = document.createElement("li");
  li.dataset.rider = r.id;
  const name = document.createElement("span");
  name.dir = "auto";
  name.textContent = r.nickname;
  if (ui.asking?.id === r.id) {
    li.dataset.asking = "true";
    const q = document.createElement("span");
    q.dir = "auto";
    q.textContent = `Remove ${r.nickname} from the class?`;
    const yes = button("Remove", null, () => {
      keep();
      void api.dropRider(r.id).then(render);
    });
    yes.disabled = !v.active;
    li.append(q, " ", yes, " ", button("Keep", null, keep));
  } else {
    const remove = button("Remove", `Remove ${r.nickname}`, () => ask(r.id));
    remove.disabled = !v.active;
    li.append(name, " ", remove);
  }
  return li;
}

/** A row's key: the rider, and whether it asks, so a row is rebuilt only when it changes. */
const keyOf = (r: RiderRow): string => `${r.id}\u0000${r.nickname}\u0000${ui.asking?.id === r.id ? "ask" : ""}`;

/** Rebuilds only the rows that changed, in the order given, so a focused Remove keeps its focus. */
function renderRows(v: RidersView, api: RidersApi): void {
  const list = $("riders-list") as HTMLUListElement;
  const want = new Map(v.rows.map((r) => [keyOf(r), r]));
  for (const li of [...list.children] as HTMLLIElement[]) if (!want.has(li.dataset.key ?? "")) li.remove();
  const have = new Map(([...list.children] as HTMLLIElement[]).map((li) => [li.dataset.key ?? "", li]));
  v.rows.forEach((r, i) => {
    const key = keyOf(r);
    let li = have.get(key);
    if (li === undefined || li.dataset.active !== String(v.active)) {
      const fresh = rowOf(r, v, api);
      fresh.dataset.key = key;
      fresh.dataset.active = String(v.active);
      if (li !== undefined) li.replaceWith(fresh);
      li = fresh;
    }
    if (list.children[i] !== li) list.insertBefore(li, list.children[i] ?? null);
  });
}

function keep(): void {
  if (ui.asking !== null) clearTimeout(ui.asking.timer);
  ui.asking = null;
  rerender();
}

function cancelCode(): void {
  if (ui.askingCode !== null) clearTimeout(ui.askingCode);
  ui.askingCode = null;
  rerender();
}

function ask(id: string): void {
  if (ui.asking !== null) clearTimeout(ui.asking.timer);
  ui.asking = { id, timer: setTimeout(keep, ASK_REMOVE_MS) };
  rerender();
}

let current: RidersApi | null = null;
const rerender = (): void => render(ui.last);

export function render(v: RidersView | null): void {
  if (!v || current === null) return;
  ui.last = v;
  // A rider who left, or a list that stopped acting, asks nothing any more.
  if (ui.asking !== null && (!v.active || !v.rows.some((r) => r.id === ui.asking?.id))) {
    clearTimeout(ui.asking.timer);
    ui.asking = null;
  }
  if (ui.askingCode !== null && !v.canNewCode) {
    clearTimeout(ui.askingCode);
    ui.askingCode = null;
  }
  if (!v.on) ui.open = false;
  $("riders").hidden = !v.shown;
  text($("riders-count"), v.count);
  shown("riders-word", v.word);
  shown("riders-line", v.line);
  shown("riders-off", v.offLine);
  $("riders-on").hidden = !v.canTurnOn;
  const toggle = $("riders-toggle");
  toggle.hidden = !v.on;
  text(toggle, ui.open ? "Hide list" : "Show list");
  toggle.setAttribute("aria-expanded", String(ui.open));
  $("riders-drawer").hidden = !(v.on && ui.open);
  $("riders-drawer").dataset.dim = String(v.dim);
  const lock = $("riders-lock") as HTMLButtonElement;
  lock.disabled = !v.active;
  text($("riders-lock-text"), v.lockText);
  text($("riders-lock-sub"), v.lockSub);
  const code = $("riders-new") as HTMLButtonElement;
  code.disabled = !v.canNewCode;
  text($("riders-new-sub"), v.newCodeSub);
  $("riders-actions").hidden = ui.askingCode !== null;
  $("riders-ask-code").hidden = ui.askingCode === null;
  text($("riders-note"), RIDERS_NOTE);
  shown("riders-empty", v.on && v.rows.length === 0 ? RIDERS_EMPTY : null);
  renderRows(v, current);
}

export function mountRiders(api: RidersApi): void {
  current = api;
  $("riders-toggle").addEventListener("click", () => {
    ui.open = !ui.open;
    rerender();
  });
  $("riders-on").addEventListener("click", () => void api.startLive().then(() => api.riders().then(render)));
  $("riders-lock").addEventListener("click", () => void api.lockJoining(!(ui.last?.locked ?? false)).then(render));
  $("riders-new").addEventListener("click", (e) => {
    e.stopPropagation();
    if (ui.askingCode !== null) clearTimeout(ui.askingCode);
    ui.askingCode = setTimeout(cancelCode, ASK_CODE_MS);
    rerender();
  });
  $("riders-new-yes").addEventListener("click", (e) => {
    e.stopPropagation();
    cancelCode();
    void api.newJoinCode().then(render);
  });
  $("riders-new-no").addEventListener("click", (e) => {
    e.stopPropagation();
    cancelCode();
  });
  // Esc, or a press anywhere else, answers Keep and Cancel.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (ui.asking !== null) keep();
    if (ui.askingCode !== null) cancelCode();
  });
  document.addEventListener("click", (e) => {
    const t = e.target as Node | null;
    if (ui.asking !== null && !(t instanceof Element && t.closest("li[data-asking]"))) keep();
    if (ui.askingCode !== null && !(t instanceof Element && t.closest("#riders-ask-code"))) cancelCode();
  });
  const refresh = (): void => void api.riders().then(render);
  setInterval(refresh, REFRESH_MS);
  refresh();
}
