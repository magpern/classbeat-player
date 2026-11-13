// The site's router: which page an address shows, the frame around it, and the way back after
// a sign-in. The page that asked is kept in memory only (never in the address or in storage),
// and only as a path of this site (core/routes.ts).
import { pageOf, returnPathOf } from "./core/routes.ts";
import { NOTICES } from "./core/sign-in-model.ts";
import type { Notice, SignInView } from "./core/sign-in-model.ts";
import { fragmentOf } from "./core/link-token.ts";
import { call } from "./net/api.ts";
import { passkeySupported } from "./net/passkey.ts";
import { notFound, offlinePlate, serverPlate, tooManyPlate } from "./pages/errors.ts";
import { signedInPage } from "./pages/signed-in.ts";
import { signInPage } from "./pages/sign-in.ts";
import { frame, PRODUCT } from "./ui/shell.ts";

let returnTo: string | null = null;
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
    const fragment = fragmentOf(location.hash);
    if (location.hash || location.search) history.replaceState(history.state, "", "/sign-in");
    document.title = `Sign in · ${PRODUCT}`;
    const main = frame({ narrow: true });
    const start: SignInView =
      fragment.kind === "token" ? { screen: "link", busy: false } : fragment.kind === "broken" ? { screen: "form", email: "", plate: { kind: "link-refused" } } : { screen: "form", email: "", notice: noticeOf(history.state) };
    const signedIn = (): void => {
      const to = returnTo ?? "/classes";
      returnTo = null;
      go(to);
    };
    signInPage(main, start, { passkey: passkeySupported(), signedIn }, fragment.kind === "token" ? fragment.token : null, fragment.kind === "token" ? "auto" : focus);
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
        returnTo = asked;
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
