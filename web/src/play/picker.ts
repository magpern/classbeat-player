// The class picker (docs/design/play.md, "The picker"): the signed-in library as the website lists it,
// title A to Z, with a different heading and one line about the page. Every title is a link to
// `/play#<class id>`. Text is only ever set with textContent.
import { el, t } from "../site/ui/dom.ts";
import { field, h1 as heading, p } from "../site/ui/kit.ts";
import { changedText, countText, filtered, FILTER_FROM, lengthText, sorted } from "./picker-model.ts";
import type { Row } from "./picker-model.ts";
import { HEADING } from "./pages.ts";
import { classAddress } from "./route.ts";

const INTRO = "Choose a class to run it here, on the manual clock. Once it is open it needs no internet; a reload starts it again from the beginning.";

function rowEl(r: Row, now: Date): HTMLElement {
  const a = el("a", { class: "a ul" }, [t("title", r.title, 4)]);
  a.href = classAddress(r.id);
  return el("div", { class: "row" }, [
    el("div", { class: "t" }, [a]),
    el("span", { class: "len" }, [t("len", lengthText(r.lengthMs), 1)]),
    el("span", { class: "src" }, [t("small", r.source, 2)]),
    el("span", { class: "chg" }, [t("small", changedText(r.changedAt, now), 2)]),
  ]);
}

/** The list of classes in `main`, with the filter from FILTER_FROM classes. */
export function classList(main: HTMLElement, all: readonly Row[], now: Date): void {
  const rows = sorted(all);
  const h = heading(HEADING);
  h.append(el("span", { class: "count" }, [t("small", countText(rows.length), 2)]));
  const list = el("div", { class: "rows has-cols" });
  const draw = (typed: string): void => list.replaceChildren(...filtered(rows, typed).map((r) => rowEl(r, now)));
  const cols = el("div", { class: "cols" }, ["Class", "Length", "From", "Changed"].map((c) => el("span", {}, [t("label", c, 3)])));
  const parts: (HTMLElement | null)[] = [h, p(INTRO)];
  if (rows.length >= FILTER_FROM) {
    const f = field("Find a class", { type: "text", name: "filter", placeholder: "Type part of a title", autocomplete: "off" });
    f.input.addEventListener("input", () => draw(f.input.value));
    parts.push(el("div", { class: "filter" }, [f.root]));
  }
  main.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null), cols, list);
  draw("");
}
