// The class list (docs/design/site.md, "Classes"): every class of the account, title A to Z, one
// link per row, a filter from 8 classes, the note after a deletion, and the empty state. Text is
// only ever set with textContent.
import { changedText, countText, filtered, filterNote, FILTER_FROM, lengthText, PAGE_ROWS, sorted } from "../core/classes-model.ts";
import type { Row } from "../core/classes-model.ts";
import { el, t } from "../ui/dom.ts";
import { button, buttons, field, h1, h2, note, p } from "../ui/kit.ts";
import { takeDeleted } from "./deleted-note.ts";
import { linkButton } from "./errors.ts";

const HEADING = "Classes";

function rowEl(r: Row, now: Date): HTMLElement {
  const a = el("a", { class: "a ul" }, [t("title", r.title, 4)]);
  a.href = `/classes/${r.id}`;
  return el("div", { class: "row" }, [
    el("div", { class: "t" }, [a]),
    el("span", { class: "len" }, [t("len", lengthText(r.lengthMs), 1)]),
    el("span", { class: "src" }, [t("small", r.source, 2)]),
    el("span", { class: "chg" }, [t("small", changedText(r.changedAt, now), 2)]),
  ]);
}

/** No classes yet: how classes arrive, and a button to Linked apps. */
function empty(main: HTMLElement): void {
  main.replaceChildren(
    h1(HEADING),
    h2("No classes yet"),
    p("Classes you send from classbeat appear here. In classbeat, choose Connect player and approve it on this site."),
    buttons(linkButton("Linked apps", "/account/links", true)),
  );
}

/** `/` focuses the filter, unless the person is typing in a field; it goes when the page does. */
function focusOnSlash(input: HTMLInputElement): void {
  const onKey = (e: KeyboardEvent): void => {
    if (!input.isConnected) return document.removeEventListener("keydown", onKey);
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const at = e.target instanceof HTMLElement ? e.target : null;
    if (at && (at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName))) return;
    e.preventDefault();
    input.focus();
  };
  document.addEventListener("keydown", onKey);
}

/** Draws the list from an ok answer's body (the rows, every page read). */
export function showClasses(main: HTMLElement, body: unknown): void {
  const all = sorted(Array.isArray(body) ? (body as Row[]) : []);
  if (all.length === 0) return empty(main);
  const now = new Date();
  const heading = h1(HEADING);
  heading.append(el("span", { class: "count" }, [t("small", countText(all.length), 2)]));
  const deleted = takeDeleted();
  const flash = deleted === null ? null : note(deleted === "" ? "Deleted the class" : `Deleted “${deleted}”`, "Your devices remove it the next time they sync");
  const cols = el("div", { class: "cols" }, ["Class", "Length", "From", "Changed"].map((c) => el("span", {}, [t("label", c, 3)])));
  const list = el("div", { class: "rows has-cols" });
  const more = el("div", { class: "more" });
  const state = el("p", { class: "small", role: "status" });
  let typed = "";
  let shown = PAGE_ROWS;

  const draw = (): void => {
    const rows = filtered(all, typed);
    list.replaceChildren(...rows.slice(0, shown).map((r) => rowEl(r, now)));
    state.replaceChildren(...(filterNote(typed, rows.length, all.length) ? [t("small", filterNote(typed, rows.length, all.length), 2)] : []));
    more.replaceChildren(
      ...(rows.length > shown
        ? [
            buttons(
              button(`Show ${Math.min(PAGE_ROWS, rows.length - shown)} more`, {
                quiet: true,
                onPress: () => {
                  const first = shown;
                  shown += PAGE_ROWS;
                  draw();
                  list.children[first]?.querySelector<HTMLElement>("a")?.focus();
                },
              }),
            ),
          ]
        : []),
    );
  };
  const parts: HTMLElement[] = [heading, ...(flash ? [flash] : [])];
  if (all.length >= FILTER_FROM) {
    const f = field("Find a class", { type: "text", name: "filter", placeholder: "Type part of a title", autocomplete: "off" });
    f.input.addEventListener("input", () => {
      typed = f.input.value;
      shown = PAGE_ROWS;
      draw();
    });
    focusOnSlash(f.input);
    parts.push(el("div", { class: "filter" }, [f.root]), state);
  }
  main.replaceChildren(...parts, cols, list, more);
  draw();
}
