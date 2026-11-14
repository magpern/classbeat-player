// A page that needs a session. This issue (#144) builds its frame and how its first request
// is answered: a 401 `not_signed_in` goes to Sign in, a 429, no answer and a server fault show
// the error pages. What each page shows once loaded comes with the second website issue.
import type { SignedInPage } from "../core/routes.ts";
import { call } from "../net/api.ts";
import { h1 } from "../ui/kit.ts";
import { offlinePlate, serverFault, tooMany } from "./errors.ts";
import { playLink } from "./play-link.ts";
import { shownByDevicePage } from "./device-pages.ts";
import { shownByAccountPage } from "./account.ts";

export interface SignedInEnv {
  readonly sessionEnded: () => void;
  /** Whether this page is still the one shown (the person may have moved on while it loaded). */
  readonly current: () => boolean;
  /** Signs this browser out, as the header's "Sign out" does. */
  readonly signOut: () => void;
  /** This browser was signed out (by "Sign out everywhere"): Sign in, with "You are signed out". */
  readonly signedOut: () => void;
  /** "Confirm it is you" by email: Sign in, which comes back to this page afterwards. */
  readonly confirmByLink: () => void;
}

export function signedInPage(main: HTMLElement, page: SignedInPage, env: SignedInEnv): void {
  // At most one wait for the connection: pressing "Try again" while offline adds no other.
  let waitingOnline = false;
  const onOnline = (): void => {
    waitingOnline = false;
    if (env.current()) void load();
  };
  const load = async (): Promise<void> => {
    const answer = await call("GET", page.load);
    if (!env.current()) return;
    const focus = main.contains(document.activeElement) && document.activeElement !== main;
    switch (answer.kind) {
      case "not_signed_in":
        return env.sessionEnded();
      case "too_many":
        tooMany(main, answer.retryAfter, () => void load());
        break;
      case "server":
        serverFault(main, () => void load());
        break;
      case "offline":
        main.replaceChildren(h1(page.title), offlinePlate(() => void load()));
        if (!waitingOnline) window.addEventListener("online", onOnline, { once: true });
        waitingOnline = true;
        break;
      default:
        if (shownByDevicePage(main, page, answer.kind === "ok" ? answer.body : undefined, env, focus, () => void load())) return;
        if (shownByAccountPage(main, page, answer.kind === "ok" ? answer.body : undefined, env, focus, () => void load())) return;
        main.replaceChildren(h1(page.title), playLink(page.load) ?? "");
    }
    if (focus || answer.kind !== "ok") main.querySelector<HTMLElement>(".plate")?.focus();
  };
  main.replaceChildren(h1(page.title));
  void load();
}
