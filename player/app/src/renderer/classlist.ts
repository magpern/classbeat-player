// The class list window (docs/design/class-list.md). It holds only the filter text and the
// selection; everything it shows comes from `screenOf` (core/list/screen.ts) over the view the
// shell sends, and every action goes to the shell, which decides. Nothing animates and nothing
// is moved: the list scrolls to a row instantly, and only when the instructor moved the selection.
import "./classlist.css";
import { jumpToLetter, moveSelection } from "../core/list/selection.ts";
import type { Move } from "../core/list/selection.ts";
import { screenOf } from "../core/list/screen.ts";
import type { Screen } from "../core/list/screen.ts";
import { FILTER_FROM } from "../core/list/filter.ts";
import type { ListUi, ListView } from "../core/list/view.ts";
import type { PairingView } from "../core/pairing/view.ts";
import { colsEl, footerEl, panelEl, plateEl, rowEl, shortcut, statusEl } from "./list-paint.ts";
import type { Act } from "./list-paint.ts";

interface ListApi {
  listView(): Promise<ListView | null>;
  startClass(id: string, hash: string): Promise<ListView | null>;
  openClassFile(): Promise<ListView | null>;
  dismissFileError(): Promise<ListView | null>;
  backToClass(): Promise<ListView | null>;
  startPairing(): Promise<PairingView | null>;
  reopenPairingPage(): Promise<PairingView | null>;
  unpair(): Promise<PairingView | null>;
}

const api = (window as unknown as { player: ListApi }).player;
const REFRESH_MS = 500;
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};
const input = $("filter-input") as HTMLInputElement;

let view: ListView | null = null;
let screen: Screen | null = null;
let ui: ListUi = { filter: "", selectedId: null, lastStartedId: null };
const shown = { status: "", file: "", of: "", body: "", footer: "", rows: "", panel: "" };
let scrollToSelection = false;

const listEl = (): HTMLElement | null => document.getElementById("list");
const rowsOf = (): readonly { id: string; hash: string; title: string }[] => (screen?.body.kind === "list" ? screen.body.rows : []);

/** The primary action of the list: Start, or Back to the class. */
function primary(): void {
  if (screen?.body.kind !== "list") return;
  const f = screen.body.footer;
  const row = screen.body.rows.find((r) => r.id === f.id);
  if (f.action === "back") void api.backToClass().then(take);
  else if (row !== undefined) {
    ui = { ...ui, lastStartedId: row.id };
    void api.startClass(row.id, row.hash).then(take);
  }
}

const act: Act = (id) => {
  switch (id) {
    case "pair":
    case "pair-again":
      return void api.startPairing().then(refresh);
    case "cancel":
      return void api.unpair().then(refresh);
    case "reopen":
      return void api.reopenPairingPage();
    case "open-file":
      return void api.openClassFile().then(take);
    case "close":
      return void api.dismissFileError().then(take);
  }
};

function select(id: string, scroll: boolean): void {
  ui = { ...ui, selectedId: id };
  scrollToSelection = scroll;
  paint();
}

function paintStatus(s: Screen): void {
  const sig = JSON.stringify([s.status, s.plate]);
  if (sig !== shown.status) {
    shown.status = sig;
    $("status-slot").replaceChildren(...(s.plate !== null ? [plateEl(s.plate, act, "status", false)] : s.status !== null ? [statusEl(s.status)] : []));
  }
  const file = JSON.stringify(s.filePlate);
  if (file !== shown.file) {
    shown.file = file;
    $("file-slot").replaceChildren(...(s.filePlate !== null ? [plateEl(s.filePlate, act, "alert", true)] : []));
  }
}

function paintFilter(s: Screen): void {
  $("filter").hidden = s.filter === null;
  const of = s.filter?.of ?? "";
  $("filter-of").textContent = of;
  $("filter-key").hidden = input.value !== "";
}

function paintList(s: Screen & { body: { kind: "list" } }): void {
  let list = listEl();
  if (list === null || shown.body !== "list") {
    shown.body = "list";
    shown.rows = shown.footer = "";
    list = document.createElement("div");
    list.id = "list";
    list.className = "list";
    list.tabIndex = 0;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Classes");
    list.addEventListener("keydown", onListKey);
    $("body").replaceChildren(colsEl(), list, document.createElement("div"));
    list.dataset.fresh = "1";
  }
  const rowsSig = JSON.stringify(s.body.rows);
  if (rowsSig !== shown.rows) {
    shown.rows = rowsSig;
    const top = list.scrollTop;
    list.replaceChildren(...s.body.rows.map((r) => rowEl(r, (id) => select(id, false))));
    list.scrollTop = top;
  }
  const footSig = JSON.stringify(s.body.footer);
  if (footSig !== shown.footer) {
    shown.footer = footSig;
    $("body").lastElementChild?.replaceWith(footerEl(s.body.footer, primary));
  }
  // The footer is in place before the scroll: its height decides how much of the list shows.
  const selected = s.body.rows.find((r) => r.selected);
  // A new list scrolls to the selection (the class last started, or the first); after that only the instructor's own moves do.
  if (list.dataset.fresh === "1") scrollToSelection = true;
  if (selected !== undefined) {
    list.setAttribute("aria-activedescendant", `row-${selected.id}`);
    if (scrollToSelection) document.getElementById(`row-${selected.id}`)?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
  scrollToSelection = false;
  if (list.dataset.fresh === "1") {
    delete list.dataset.fresh;
    // Initial focus: the list, with a row selected.
    if (document.activeElement === document.body) list.focus();
  }
}

function paintPanel(s: Screen & { body: { kind: "panel" } }): void {
  const sig = JSON.stringify(s.body.panel);
  if (shown.body === "panel" && sig === shown.panel) return;
  shown.body = "panel";
  shown.panel = sig;
  $("body").replaceChildren(panelEl(s.body.panel, act));
  // With no list, the primary button of the panel takes the focus, unless the instructor is typing.
  if (document.activeElement === document.body || document.activeElement === null) ($("body").querySelector("button.primary, button") as HTMLElement | null)?.focus();
}

function paint(): void {
  if (view === null) return;
  screen = screenOf(view, ui, Date.now());
  ui = { ...ui, selectedId: screen.selectedId };
  $("app").dataset.body = screen.body.kind === "panel" ? screen.body.panel.kind : "list";
  $("count").hidden = screen.count === null;
  $("count").textContent = screen.count ?? "";
  paintStatus(screen);
  paintFilter(screen);
  if (screen.body.kind === "list") paintList(screen as Screen & { body: { kind: "list" } });
  else paintPanel(screen as Screen & { body: { kind: "panel" } });
  if ($("live").textContent !== screen.announce) $("live").textContent = screen.announce;
}

function take(v: ListView | null): void {
  if (v !== null) view = v;
  paint();
}
function refresh(): void {
  void api.listView().then(take);
}

function onListKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const moves: Record<string, Move> = { ArrowUp: "up", ArrowDown: "down", Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown" };
  const move = moves[e.key];
  if (move !== undefined) {
    e.preventDefault();
    const list = listEl();
    const rowHeight = list?.querySelector<HTMLElement>(".row")?.offsetHeight ?? 64;
    const next = moveSelection(rowsOf().map((r) => r.id), ui.selectedId, move, Math.floor((list?.clientHeight ?? 400) / rowHeight));
    if (next !== null) select(next, true);
  } else if (e.key === "Enter") {
    e.preventDefault();
    primary();
  } else if (e.key.length === 1 && e.key !== " " && e.key !== "/") {
    e.preventDefault();
    if ((view?.rows.length ?? 0) >= FILTER_FROM) {
      input.focus();
      input.value = e.key;
      onFilterInput();
    } else {
      const next = jumpToLetter(rowsOf(), ui.selectedId, e.key);
      if (next !== null) select(next, true);
    }
  }
}

function onFilterInput(): void {
  ui = { ...ui, filter: input.value };
  paint();
}
input.addEventListener("input", onFilterInput);
input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    if (input.value !== "") {
      input.value = "";
      onFilterInput();
    } else listEl()?.focus();
  } else if (e.key === "ArrowDown" || e.key === "Enter") {
    e.preventDefault();
    listEl()?.focus();
  }
});

document.addEventListener("keydown", (e) => {
  const inField = document.activeElement === input;
  if (((e.key === "/" && !e.ctrlKey && !e.metaKey) || ((e.key === "f" || e.key === "F") && (e.ctrlKey || e.metaKey))) && !inField && screen?.filter != null) {
    e.preventDefault();
    input.focus();
  } else if (e.key === "Escape" && !inField) {
    // Close the file-error plate, else cancel a pairing in progress.
    const close = document.querySelector<HTMLElement>('#file-slot [data-action="close"]');
    const cancel = document.querySelector<HTMLElement>('#body [data-action="cancel"]');
    (close ?? cancel)?.click();
  }
});

$("open-file").addEventListener("click", () => act("open-file"));
$("open-key").textContent = shortcut("Ctrl+O");
// A drag over the window must not make the page navigate (the shell refuses it as well).
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

setInterval(refresh, REFRESH_MS);
refresh();
