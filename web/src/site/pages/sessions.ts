// Account: Sessions (docs/design/site.md, "Account"; ADR 0002, sections 4 and 5): the browsers
// signed in, this one marked by a word in an outline. Its button signs out; any other row's ends
// that session at once. "Sign out everywhere" asks in a panel first, "Cancel" first and focused,
// and needs a recent sign-in. Browser names are the backend's text, set as text only.
import { outcomeOf } from "../core/account-model.ts";
import { lastUsedWords, dayWords } from "../core/devices-model.ts";
import type { Day } from "../core/devices-model.ts";
import { rowAction, SESSION_WORDS, sessionsOf } from "../core/sessions-model.ts";
import type { SiteSession } from "../core/sessions-model.ts";
import { call } from "../net/api.ts";
import { dayOf, today } from "../ui/day.ts";
import { el, t, uid } from "../ui/dom.ts";
import { button, buttons, h2, note, p } from "../ui/kit.ts";
import { focusMessage, hasMessage, messageNodes, NO_MESSAGES, plateOnly } from "./account-messages.ts";
import type { Messages } from "./account-messages.ts";
import { serverFault } from "./errors.ts";
import type { SignedInEnv } from "./signed-in.ts";

const readable = (list: readonly SiteSession[]): boolean => list.every((s) => dayOf(s.startedAt) !== null && dayOf(s.lastUsedAt) !== null);

/** Shows the Sessions page in `box` for the body of `GET sessions`. A body it does not understand is the server fault. */
export function sessionsPage(main: HTMLElement, box: HTMLElement, body: unknown, env: SignedInEnv, reload: () => void): void {
  const first = sessionsOf(body);
  if (first === null || !readable(first)) return serverFault(main, reload);
  let list: SiteSession[] = first;
  let asking = false;
  let busy = false;
  let messages: Messages = NO_MESSAGES;
  let ended: string | null = null;

  const host = {
    env,
    get: () => messages,
    set: (m: Messages) => {
      [messages, ended] = [m, null];
      draw(null);
      focusMessage(main, box);
    },
  };

  async function readAgain(after: Messages): Promise<void> {
    const a = await call("GET", "sessions");
    if (!env.current()) return;
    if (a.kind === "not_signed_in") return env.sessionEnded();
    const fresh = a.kind === "ok" ? sessionsOf(a.body) : null;
    if (fresh === null || !readable(fresh)) {
      const o = outcomeOf(a);
      return host.set(plateOnly(o.kind === "plate" ? o.plate : { kind: "server" }));
    }
    [list, asking] = [fresh, false];
    host.set(after);
  }

  async function endOne(s: SiteSession): Promise<void> {
    if (busy) return;
    busy = true;
    for (const b of box.querySelectorAll<HTMLButtonElement>(".ac-acts button")) b.disabled = true;
    const at = list.indexOf(s);
    const o = outcomeOf(await call("DELETE", `sessions/${s.id}`));
    busy = false;
    if (!env.current()) return;
    if (o.kind === "ended") return env.sessionEnded();
    if (o.kind === "gone") return void readAgain(NO_MESSAGES);
    if (o.kind === "plate") return host.set(plateOnly(o.plate));
    list = list.filter((x) => x.id !== s.id);
    [messages, ended] = [NO_MESSAGES, s.browser];
    // Focus goes to the next row, or the one before when the last went (site.md, "Keyboard").
    const next = list[Math.min(at, list.length - 1)];
    draw(next ? `[data-session="${next.id}"]` : "[data-end-all]");
  }

  async function endAll(): Promise<void> {
    if (busy) return;
    busy = true;
    for (const b of box.querySelectorAll<HTMLButtonElement>(".ac-panel button")) b.disabled = true;
    const o = outcomeOf(await call("POST", "sessions/end-all"));
    busy = false;
    if (!env.current()) return;
    if (o.kind === "done") return env.signedOut();
    if (o.kind === "ended") return env.sessionEnded();
    if (o.kind === "gone") return host.set(plateOnly({ kind: "server" }));
    // Asked to confirm it is them: the panel closes and nothing is sent again by itself. Any other
    // refusal keeps the panel open under the plate.
    if (o.plate.kind === "confirm") asking = false;
    host.set(plateOnly(o.plate));
  }

  function row(s: SiteSession, now: Day): HTMLElement {
    const started = dayOf(s.startedAt) as Day;
    const used = dayOf(s.lastUsedAt) as Day;
    const title = el("div", { class: "ac-t" }, [t("title", s.browser, 3), ...(s.current ? [" ", el("span", { class: "tag" }, [t("label", SESSION_WORDS.thisBrowser, 1)])] : [])]);
    const meta = el("div", { class: "ac-m" }, [SESSION_WORDS.started(dayWords(started, now)), lastUsedWords(used, now)].map((w) => el("span", {}, [t("small", w, 3)])));
    const act = button(rowAction(s), { onPress: () => (s.current ? env.signOut() : void endOne(s)) });
    act.dataset.session = s.id;
    return el("div", { class: `ac-item${s.current ? " this" : ""}` }, [el("div", {}, [title, meta]), el("div", { class: "ac-acts" }, [act])]);
  }

  function panel(): HTMLElement {
    const head = el("h2", { id: uid("end-all") }, [t("h2", SESSION_WORDS.endAllAsk, 3)]);
    const said = el("p", { id: uid("end-all-said") }, [t("body", SESSION_WORDS.endAllConsequence)]);
    const cancel = button(SESSION_WORDS.cancel, { primary: true, onPress: close });
    cancel.dataset.keep = "";
    const go = button(SESSION_WORDS.endAll, { onPress: () => void endAll() });
    const pane = el("div", { class: "ac-panel panel", role: "alertdialog", "aria-labelledby": head.id, "aria-describedby": said.id }, [head, said, buttons(cancel, go)]);
    pane.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
    });
    return pane;
  }

  function open(): void {
    [asking, messages, ended] = [true, NO_MESSAGES, null];
    draw("[data-keep]");
  }

  function close(): void {
    if (busy) return;
    [asking, messages] = [false, NO_MESSAGES];
    draw("[data-end-all]");
  }

  function content(): Node[] {
    const out: Node[] = [h2(SESSION_WORDS.heading), ...messageNodes(host)];
    if (ended !== null) out.push(note(SESSION_WORDS.ended(ended), SESSION_WORDS.endedDetail));
    if (asking) out.push(panel());
    else if (!hasMessage(messages) && ended === null) out.push(p(SESSION_WORDS.intro));
    const now = today();
    out.push(el("div", { class: "ac-rows" }, list.map((s) => row(s, now))));
    if (!asking) {
      const all = button(SESSION_WORDS.endAll, { onPress: open });
      all.dataset.endAll = "";
      out.push(buttons(all));
    }
    return out;
  }

  function draw(focus: string | null): void {
    box.replaceChildren(...content());
    if (focus !== null) box.querySelector<HTMLElement>(focus)?.focus();
  }

  draw(null);
}
