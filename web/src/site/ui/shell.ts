// The page shell (docs/design/site.md, "What every page has"): the skip link, the header with
// the product name and, when signed in, Classes, Devices, Account and "Sign out", and one main.
import type { Nav } from "../core/routes.ts";
import { el, t } from "./dom.ts";

/** The product's name is not set yet: one string to replace. */
export const PRODUCT = "Class player";

export interface ShellOptions {
  /** The current section when signed in; null on a signed-in page outside every section; undefined when signed out. */
  readonly nav?: Nav | null;
  readonly narrow?: boolean;
  readonly onSignOut?: () => void;
}

const LINKS: readonly (readonly [Nav, string, string])[] = [
  ["classes", "Classes", "/classes"],
  ["devices", "Devices", "/devices"],
  ["account", "Account", "/account"],
];

/** Builds the page frame in the body and returns its main. */
export function frame(o: ShellOptions): HTMLElement {
  const skip = el("a", { class: "skip" }, [t("btn", "Skip to content", 1)]);
  skip.href = "#main";
  const bar = el("div", { class: "bar" }, [el("span", { class: "brand" }, [t("brand", PRODUCT, 1)])]);
  if (o.nav !== undefined) {
    const links = LINKS.map(([key, text, href]) => {
      const a = el("a", { class: `a${o.nav === key ? " cur" : ""}`, "aria-current": o.nav === key ? "page" : undefined }, [t("btn", text, 1)]);
      a.href = href;
      return a;
    });
    const out = el("button", { class: "navbtn out" }, [t("body", "Sign out", 1)]);
    out.type = "button";
    const signOut = o.onSignOut;
    if (signOut) out.addEventListener("click", () => signOut());
    bar.append(el("nav", { class: "nav", "aria-label": "Main" }, [...links, out]));
  }
  const main = el("main", { class: `page${o.narrow ? " narrow" : ""}`, id: "main" });
  main.tabIndex = -1;
  document.body.replaceChildren(skip, el("header", { class: "head" }, [bar]), main);
  return main;
}
