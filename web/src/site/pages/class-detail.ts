// The class details page (docs/design/site.md, "Classes", class details). Read only: nothing
// edits, reorders or ranks a class. Under the title and facts, one actions row: "Play on this
// device" (the quiet outlined link, only for a class with a canonical id) and "Delete class", a
// quiet button; neither is the filled primary. Delete opens the confirmation in the row's place.
import { detailOf } from "../core/class-detail-model.ts";
import type { Detail } from "../core/class-detail-model.ts";
import { classIdOfPage } from "../core/routes.ts";
import { el, t } from "../ui/dom.ts";
import { button, buttons, h1, p, small } from "../ui/kit.ts";
import { deletePanel } from "./class-delete.ts";
import { sections } from "./class-sections.ts";
import { linkButton } from "./errors.ts";
import { playLink } from "./play-link.ts";
import type { SignedInEnv } from "./signed-in.ts";

/** The link back to the list, a row of its own above the title. */
function back(): HTMLAnchorElement {
  const a = el("a", { class: "back a ul" }, [t("body", "← Classes", 1)]);
  a.href = "/classes";
  return a;
}

/** "That class is not here": a deleted class, an unknown id, another account's id and a removal marker all give this. */
export function classNotFound(main: HTMLElement): void {
  main.replaceChildren(h1("That class is not here"), p("It may have been deleted. Go back to your classes."), buttons(linkButton("Classes", "/classes", true)));
}

/** Draws the class `load` named, from the answer's body, into `main`. */
export function showClass(main: HTMLElement, load: string, body: unknown, env: SignedInEnv): void {
  const parsed = detailOf(body, new Date());
  const found = classIdOfPage(load);
  if (parsed === null || found === null) return classNotFound(main);
  const id: string = found;
  const detail: Detail = parsed;
  const actions = el("div", { class: "actions" });
  const drawActions = (): void => {
    const del = button("Delete class", { onPress: confirmDelete });
    actions.replaceChildren(buttons(playLink(load), del));
  };
  function confirmDelete(): void {
    const { panel, focusKeep } = deletePanel({
      id,
      title: detail.title,
      env,
      keep: () => {
        drawActions();
        actions.querySelector<HTMLElement>("button")?.focus();
      },
      gone: () => {
        classNotFound(main);
        main.querySelector<HTMLElement>("h1")?.focus();
      },
    });
    actions.replaceChildren(panel);
    focusKeep();
  }
  drawActions();
  main.replaceChildren(back(), h1(detail.title ?? "Class details"), ...(detail.facts ? [small(detail.facts)] : []), actions, ...sections(detail));
}
