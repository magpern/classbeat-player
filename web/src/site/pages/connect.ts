// Connect an app (docs/design/site.md, "Account"; ADR 0002, section 7, steps 2 to 4). On load the
// page asks the backend which app this is (`POST source-links/check`); the name it shows is that
// answer's, as text. Nothing is approved without a press of "Connect <name>", which sends
// `POST source-links/approve` as a script request (never a form submission). The page then goes
// to the one address that answer holds, and shows "Back to <name>" for when that is blocked.
// "Cancel" and every plate go to Linked apps, inside this site. The address to go back to holds
// the link code: it lives only in this closure, never in the page, an attribute, storage or a log.
import { CONNECT_WORDS, linkPlateWords } from "../core/connect-words.ts";
import { afterApprove, afterCheck, approveBody, askOf, checkBody, SCOPE_WORDS } from "../core/source-link-model.ts";
import type { LinkAsk, LinkPlate } from "../core/source-link-model.ts";
import { call } from "../net/api.ts";
import { el, t } from "../ui/dom.ts";
import { button, buttons, h1, h2, note, p, plate, working } from "../ui/kit.ts";
import { linkButton } from "./errors.ts";
import type { SignedInEnv } from "./signed-in.ts";
import "./connect.css";

type View =
  | { readonly screen: "checking" }
  | { readonly screen: "ask"; readonly name: string; readonly scope: readonly string[]; readonly busy: boolean; readonly plate: LinkPlate | null }
  | { readonly screen: "refused"; readonly name: string | null; readonly plate: LinkPlate }
  | { readonly screen: "done"; readonly name: string };

const toLinkedApps = (primary = false): HTMLAnchorElement => {
  const a = linkButton(CONNECT_WORDS.linkedApps, "/account/links", primary);
  if (!primary) a.classList.add("q");
  return a;
};

export function connectPage(main: HTMLElement, env: SignedInEnv): void {
  main.classList.add("narrow");
  const ask: LinkAsk | null = askOf(location.search);
  let view: View = ask === null ? { screen: "refused", name: null, plate: { kind: "not-valid" } } : { screen: "checking" };
  // The address the approval answered with: kept here only, for "Back to <name>".
  let back: string | null = null;

  async function check(a: LinkAsk): Promise<void> {
    view = { screen: "checking" };
    draw();
    const next = afterCheck(a, await call("POST", "source-links/check", checkBody(a)));
    if (!env.current()) return;
    if (next.kind === "ended") return env.sessionEnded();
    view = next.kind === "ask" ? { screen: "ask", name: next.name, scope: next.scope, busy: false, plate: null } : { screen: "refused", name: null, plate: next.plate };
    draw();
    // A check decides nothing, so one made offline is made again once the browser is back online.
    if (next.kind === "plate" && next.plate.kind === "offline") {
      const shown = view;
      window.addEventListener("online", () => {
        if (env.current() && view === shown) void check(a);
      }, { once: true });
    }
  }

  async function approve(a: LinkAsk, asked: Extract<View, { screen: "ask" }>): Promise<void> {
    if (asked.busy) return;
    view = { ...asked, busy: true, plate: null };
    draw();
    const next = afterApprove(a, await call("POST", "source-links/approve", approveBody(a)));
    if (!env.current()) return;
    if (next.kind === "ended") return env.sessionEnded();
    if (next.kind === "plate") {
      // The link itself refused, or the limit: nothing more to ask. Anything else: ask again under the plate.
      view = next.plate.kind === "not-valid" || next.plate.kind === "limit" ? { screen: "refused", name: asked.name, plate: next.plate } : { ...asked, busy: false, plate: next.plate };
      return draw();
    }
    back = next.to;
    view = { screen: "done", name: asked.name };
    draw();
    location.assign(next.to);
  }

  function plateOf(pl: LinkPlate, retry: (() => void) | null): HTMLDivElement {
    const w = linkPlateWords(pl);
    const action = pl.kind === "not-valid" || pl.kind === "limit" ? toLinkedApps() : retry && button(CONNECT_WORDS.tryAgain, { quiet: true, onPress: retry });
    return plate(w.head, w.detail, action);
  }

  function askNodes(v: Extract<View, { screen: "ask" }>): Node[] {
    const a = ask as LinkAsk;
    const connect = button(CONNECT_WORDS.connect(v.name), { primary: true, full: true, disabled: v.busy, onPress: () => void approve(a, v) });
    connect.dataset.connect = "";
    const cancel = linkButton(CONNECT_WORDS.cancel, "/account/links");
    cancel.classList.add("full");
    const able = el("ul", { class: "plain" }, v.scope.map((s) => el("li", {}, [t("body", SCOPE_WORDS[s])])));
    return [
      h1(CONNECT_WORDS.ask(v.name)),
      v.plate ? plateOf(v.plate, null) : null,
      p(CONNECT_WORDS.asks(v.name)),
      h2(CONNECT_WORDS.able),
      able,
      p(CONNECT_WORDS.nothingElse),
      v.busy ? working(CONNECT_WORDS.connecting(v.name)) : null,
      buttons(connect, cancel),
    ].filter((n) => n !== null);
  }

  function screen(): Node[] {
    switch (view.screen) {
      case "checking":
        return [h1(CONNECT_WORDS.title), working(CONNECT_WORDS.checking)];
      case "ask":
        return askNodes(view);
      case "refused": {
        const retry = ask === null ? null : () => void check(ask);
        return [h1(view.name === null ? CONNECT_WORDS.title : CONNECT_WORDS.ask(view.name)), plateOf(view.plate, retry)];
      }
      case "done": {
        const to = back;
        const again = button(CONNECT_WORDS.back(view.name), {
          primary: true,
          onPress: () => {
            if (to !== null) location.assign(to);
          },
        });
        return [h1(CONNECT_WORDS.done), note(CONNECT_WORDS.connected(view.name), CONNECT_WORDS.goingBack(view.name)), buttons(again)];
      }
    }
  }

  function draw(): void {
    main.replaceChildren(...screen());
    // Focus goes where the change is: a plate, the note, the working line; the question's own button (site.md).
    const target = main.querySelector<HTMLElement>(".plate") ?? main.querySelector<HTMLElement>(".note") ?? (view.screen === "ask" && !view.busy ? main.querySelector<HTMLElement>("[data-connect]") : null) ?? main.querySelector<HTMLElement>("h1");
    target?.focus();
  }

  if (ask === null) draw();
  else void check(ask);
}
