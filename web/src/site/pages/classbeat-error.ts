// `/sign-in#error=classbeat` (docs/design/site.md, "Sign in"; ADR 0010, sections 2 and 5): every
// refusal of classbeat's callback lands here, a sign-in's and a re-authentication's alike, and the
// address carries no reason. So the page asks `GET me` first. Signed out (401), the sign-in did not
// finish: the sign-in page with its plate. Still signed in (200), classbeat did not confirm it is
// you: "Confirm with classbeat" starts a re-authentication (`reauth`), never a sign-in, because a
// sign-in would end this session and could sign in as another account. A check that fails shows
// its own plate and offers no sign-in action.
import { afterErrorCheck, NOT_CONFIRMED_WORDS } from "../core/classbeat-start-model.ts";
import type { ErrorCheck } from "../core/classbeat-start-model.ts";
import type { Plate } from "../core/sign-in-model.ts";
import { call } from "../net/api.ts";
import { el, t } from "../ui/dom.ts";
import { h1, working } from "../ui/kit.ts";
import { confirmWithClassbeat } from "./account-messages.ts";
import type { Messages, MessageHost } from "./account-messages.ts";
import { confirmNodes } from "./confirm.ts";
import type { ConfirmView } from "./confirm.ts";
import { offlinePlate, serverFault, tooMany } from "./errors.ts";

export interface ClassbeatErrorEnv {
  /** Whether this page is still the one shown. */
  readonly current: () => boolean;
  /** Signed out: the sign-in page, headed by this plate. */
  readonly signIn: (plate: Plate) => void;
  /** Still signed in: the signed-in frame (no section marked), and its main. */
  readonly signedInFrame: () => HTMLElement;
  /** The session ended while confirming: Sign in, with "Your session ended". */
  readonly sessionEnded: () => void;
}

/** Asks `GET me`, then shows what `#error=classbeat` means. `main` is the signed-out frame's. */
export function classbeatErrorPage(main: HTMLElement, env: ClassbeatErrorEnv): void {
  const check = async (): Promise<void> => {
    main.replaceChildren(h1("Sign in"), working(NOT_CONFIRMED_WORDS.checking));
    const next: ErrorCheck = afterErrorCheck(await call("GET", "me"));
    if (!env.current()) return;
    if (next.kind === "unfinished") return env.signIn({ kind: "classbeat-unfinished" });
    if (next.kind === "still-signed-in") return notConfirmed(env.signedInFrame(), env);
    const retry = (): void => void check();
    if (next.why === "too-many") tooMany(main, next.retryAfter, retry);
    else if (next.why === "server") serverFault(main, retry);
    else main.replaceChildren(h1("Sign in"), offlinePlate(retry));
    main.querySelector<HTMLElement>(".plate")?.focus();
  };
  void check();
}

/** "classbeat did not confirm (still signed in)": not the sign-in page; no email form, no passkey. */
function notConfirmed(main: HTMLElement, env: ClassbeatErrorEnv): void {
  let view: ConfirmView = { kind: "ask" };
  const back = (): HTMLAnchorElement => {
    const a = el("a", { class: "btn q" }, [t("btn", NOT_CONFIRMED_WORDS.back, 2)]);
    a.href = "/classes";
    return a;
  };
  const draw = (): void => {
    const nodes = confirmNodes(view, { withClassbeat: () => void confirmWithClassbeat(host), ask: NOT_CONFIRMED_WORDS, also: back });
    main.replaceChildren(h1(NOT_CONFIRMED_WORDS.title), ...nodes);
    main.querySelector<HTMLElement>(".plate, [data-confirm=waiting]")?.focus();
  };
  const host: MessageHost = {
    env,
    get: (): Messages => ({ plate: null, confirm: view }),
    set: (m: Messages) => {
      view = m.confirm ?? { kind: "ask" };
      draw();
    },
  };
  draw();
}
