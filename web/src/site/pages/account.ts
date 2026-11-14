// The account area (docs/design/site.md, "What every page has" and "Account"): the page title and
// the four sub-page links, beside the content at desktop width and above it below that. Which
// sub-page an address shows is read here, at the edge.
import { ACCOUNT_SUBS } from "../core/account-model.ts";
import type { AccountSub } from "../core/account-model.ts";
import type { SignedInPage } from "../core/routes.ts";
import { el, t } from "../ui/dom.ts";
import { h1 } from "../ui/kit.ts";
import { connectPage } from "./connect.ts";
import { dataPage } from "./data.ts";
import { linksPage } from "./links.ts";
import { passkeysPage } from "./passkeys.ts";
import { sessionsPage } from "./sessions.ts";
import type { SignedInEnv } from "./signed-in.ts";
import "./account.css";

/** Builds the account frame in `main` with `current` marked, and returns the box its sub-page fills. */
export function accountFrame(main: HTMLElement, current: AccountSub): HTMLDivElement {
  const links = ACCOUNT_SUBS.map(([key, text, href]) => {
    const a = el("a", { class: `a${key === current ? " cur" : ""}`, "aria-current": key === current ? "page" : undefined }, [t("btn", text, 1)]);
    a.href = href;
    return a;
  });
  const body = el("div", { class: "acct-body" });
  main.replaceChildren(h1("Account"), el("div", { class: "acct" }, [el("nav", { class: "subnav", "aria-label": "Account" }, links), body]));
  return body;
}

/** The sub-pages, by address. */
const SUBS = new Map<string, AccountSub>([
  ["/account/sessions", "sessions"],
  ["/account/passkeys", "passkeys"],
  ["/account/links", "links"],
  ["/account/data", "data"],
]);

/** Shows an account sub-page for the body of its first request; false for any other page. */
export function shownByAccountPage(main: HTMLElement, page: SignedInPage, body: unknown, env: SignedInEnv, focus: boolean, reload: () => void): boolean {
  if (page.nav !== "account") return false;
  // Connect an app reads `sessions` first only to know the person is signed in; its body is not used.
  if (location.pathname === "/link/source") {
    connectPage(main, env);
    return true;
  }
  const sub = SUBS.get(location.pathname);
  if (sub === undefined) return false;
  const box = accountFrame(main, sub);
  if (sub === "sessions") sessionsPage(main, box, body, env, reload);
  else if (sub === "passkeys") passkeysPage(main, box, body, env, reload);
  else if (sub === "links") linksPage(main, box, body, env, reload);
  // Your data reads `sessions` first only to know the person is signed in; its body is not used.
  else dataPage(main, box, env);
  if (focus && main.contains(box)) main.querySelector<HTMLElement>("h1")?.focus();
  return true;
}
