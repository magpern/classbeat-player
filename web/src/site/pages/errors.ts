// The error pages (docs/design/site.md, "Errors"): shown in place of a page. No code and no
// technical word is ever shown.
import { waitWords } from "../core/answer.ts";
import { el, t } from "../ui/dom.ts";
import { button, buttons, h1, p, plate } from "../ui/kit.ts";

/** A link that looks like a button (it goes somewhere; it changes nothing). */
export function linkButton(text: string, href: string, primary = false): HTMLAnchorElement {
  const a = el("a", { class: `btn${primary ? " primary" : ""}` }, [t("btn", text, 2)]);
  a.href = href;
  return a;
}

export function notFound(main: HTMLElement): void {
  main.replaceChildren(h1("That page is not here"), p("The address may be wrong, or the page may have moved."), buttons(linkButton("Classes", "/classes", true)));
}

export const tooManyPlate = (retryAfter: number | null, retry: () => void): HTMLDivElement =>
  plate("Please wait a little", `You have asked for too much in a short time. Try again ${waitWords(retryAfter)}. Nothing was changed.`, button("Try again", { quiet: true, onPress: retry }));

export function tooMany(main: HTMLElement, retryAfter: number | null, retry: () => void): void {
  main.replaceChildren(h1("Too many requests"), tooManyPlate(retryAfter, retry));
}

export function serverFault(main: HTMLElement, retry: () => void): void {
  main.replaceChildren(h1("Something went wrong"), serverPlate(retry));
}

export const serverPlate = (retry: () => void): HTMLDivElement =>
  plate("That did not work, and it was not your doing", "Try again in a moment. If you were changing something, check that it happened before you repeat it.", button("Try again", { quiet: true, onPress: retry }));

/** Offline: what is shown stays; the page tries again by itself when the browser is back online. */
export const offlinePlate = (retry: () => void): HTMLDivElement =>
  plate("You are offline", "Check your connection. What is on this page may be out of date, and changes wait until you are back. This page tries again by itself.", button("Try again", { quiet: true, onPress: retry }));
