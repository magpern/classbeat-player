// The site's router: which page an address shows, the frame around it, and the way back after
// a sign-in. The page that asked is kept in memory only (never in storage), and only as a path of
// this site or an entry of the fixed table of other pages (core/routes.ts). A page of the site
// is opened in place; another page (the companion at /control) is loaded.
import { entryBackOf, pageOf, returnPathOf } from "./core/routes.ts";
import { NOTICES } from "./core/sign-in-model.ts";
import type { Notice, SignInView } from "./core/sign-in-model.ts";
import { fragmentOf } from "./core/link-token.ts";
import { call } from "./net/api.ts";
import { passkeySupported } from "./net/passkey.ts";
import { notFound, offlinePlate, serverPlate, tooManyPlate } from "./pages/errors.ts";
import { signedInPage } from "./pages/signed-in.ts";
import { signInPage } from "./pages/sign-in.ts";
import { frame, PRODUCT } from "./ui/shell.ts";

/**
 * Where a sign-in goes back to: a page of this site, or another page that has to be loaded. An
 * entry of the table read from a sign-in fragment also keeps its name (`control[.CODE]`), which
 * a link request carries (ADR 0006, decision 5).
 */
let returnTo: { readonly to: string; readonly load: boolean; readonly entry?: string } | null = null;
let shown = 0;

const noticeOf = (state: unknown): Notice | undefined => {
  const n = typeof state === "object" && state !== null ? (state as { notice?: unknown }).notice : undefined;
  return NOTICES.find((x) => x === n);
};

/** Opens a page of this site. A notice (signed out, session ended, deleted) goes with it. */
export function go(path: string, notice?: Notice): void {
  history.pushState(notice ? { notice } : null, "", path);
  render("heading");
}

async function signOut(main: HTMLElement): Promise<void> {
  const answer = await call("POST", "sign-out");
  if (answer.kind === "ok") {
    returnTo = null;
    return go("/sign-in", "signed-out");
  }
  main.querySelector(".plate")?.remove();
  const retry = (): void => void signOut(main);
  const p = answer.kind === "offline" ? offlinePlate(retry) : answer.kind === "too_many" ? tooManyPlate(answer.retryAfter, retry) : serverPlate(retry);
  const head = main.querySelector("h1");
  if (head) head.after(p);
  else main.prepend(p);
  p.focus();
}

function render(focus: "heading" | "none"): void {
  const ticket = (shown += 1);
  const page = pageOf(location.pathname);
  if (page.kind === "redirect") {
    history.replaceState(history.state, "", page.to);
    return render(focus);
  }
  if (page.kind === "sign-in") {
    // The token leaves the address bar before anything else happens (ADR 0002, section 4, step 5).
    // The fragment may name an entry to return to (/control), after a token or alone (ADR 0006,
    // decision 4): kept in memory, also after a refused link.
    const fragment = fragmentOf(location.hash);
    let entry: ReturnType<typeof entryBackOf> = null;
    if (fragment.kind === "token") entry = fragment.back ?? null;
    else if (fragment.kind === "none") entry = entryBackOf(location.hash);
    if (entry !== null) returnTo = { to: entry.path, load: true, entry: entry.field };
    if (location.hash || location.search) history.replaceState(history.state, "", "/sign-in");
    document.title = `Sign in · ${PRODUCT}`;
    const main = frame({ narrow: true });
    const start: SignInView =
      fragment.kind === "token" ? { screen: "link", busy: false } : fragment.kind === "broken" ? { screen: "form", email: "", plate: { kind: "link-refused" } } : { screen: "form", email: "", notice: noticeOf(history.state) };
    const signedIn = (): void => {
      const back = returnTo ?? { to: "/classes", load: false };
      returnTo = null;
      if (back.load) location.assign(back.to);
      else go(back.to);
    };
    // Only an entry read from a sign-in fragment goes with a link request, never a path (ADR 0006, decision 5).
    const returnEntry = (): string | null => returnTo?.entry ?? null;
    signInPage(main, start, { passkey: passkeySupported(), signedIn, returnEntry }, fragment.kind === "token" ? fragment.token : null, fragment.kind === "token" ? "auto" : focus);
    return;
  }
  if (page.kind === "not-found") {
    document.title = `Page not found · ${PRODUCT}`;
    const main = frame({ nav: null, onSignOut: () => void signOut(main) });
    notFound(main);
  } else {
    document.title = `${page.title} · ${PRODUCT}`;
    const main = frame({ nav: page.nav, onSignOut: () => void signOut(main) });
    const asked = returnPathOf(location.pathname, location.search);
    signedInPage(main, page, {
      current: () => ticket === shown,
      sessionEnded: () => {
        returnTo = asked === null ? null : { to: asked, load: false };
        go("/sign-in", "ended");
      },
    });
  }
  if (focus === "heading") document.querySelector<HTMLElement>("main h1")?.focus();
}

function onClick(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement) || a.target) return;
  if (a.classList.contains("skip")) {
    e.preventDefault();
    document.querySelector<HTMLElement>("main")?.focus();
    return;
  }
  const url = new URL(a.href);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  go(url.pathname + url.search);
}

export function start(): void {
  document.addEventListener("click", onClick);
  window.addEventListener("popstate", () => render("heading"));
  render("none");
}
