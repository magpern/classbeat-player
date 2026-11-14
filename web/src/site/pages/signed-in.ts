// A page that needs a session: its frame and how its first request is answered. A 401
// `not_signed_in` goes to Sign in; a 429, no answer and a server fault show the error pages. What
// a page shows once loaded is its `View` (the class pages, pages/class-views.ts); a page without
// one shows its heading only.
import type { SignedInPage } from "../core/routes.ts";
import { call } from "../net/api.ts";
import { h1, working } from "../ui/kit.ts";
import { offlinePlate, serverFault, tooMany } from "./errors.ts";
import type { View } from "./view.ts";

export interface SignedInEnv {
  readonly sessionEnded: () => void;
  /** Whether this page is still the one shown (the person may have moved on while it loaded). */
  readonly current: () => boolean;
  /** Opens a page of this site (after a deletion, back to the list). */
  readonly open: (path: string) => void;
}

export function signedInPage(main: HTMLElement, page: SignedInPage, env: SignedInEnv, view?: View): void {
  // At most one wait for the connection: pressing "Try again" while offline adds no other.
  let waitingOnline = false;
  const onOnline = (): void => {
    waitingOnline = false;
    if (env.current()) void load();
  };
  const load = async (): Promise<void> => {
    const answer = await (view ? view.read() : call("GET", page.load));
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
      case "refused":
        if (!view) {
          main.replaceChildren(h1(page.title));
        } else if (!view.refused(main, answer)) {
          serverFault(main, () => void load());
        }
        break;
      default:
        if (view) view.show(main, answer.body);
        else main.replaceChildren(h1(page.title));
    }
    const plate = main.querySelector<HTMLElement>(".plate");
    if (plate && (focus || answer.kind !== "ok")) plate.focus();
    // The heading had the focus while the page loaded (a page just opened): the new heading keeps it.
    else if (view && focus) main.querySelector<HTMLElement>("h1")?.focus();
  };
  main.replaceChildren(h1(page.title), ...(view ? [working(view.loading)] : []));
  void load();
}
