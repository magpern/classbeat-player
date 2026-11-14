// Account: Linked apps (docs/design/site.md, "Account"; ADR 0002, section 7): the apps that may
// send classes to the account, and revoking one in place. The confirmation replaces the row:
// "Keep it" first and focused, Esc cancels and returns focus to the row's "Revoke". Revoking keeps
// the classes. An app's name is the backend's text, set as text only.
import { outcomeOf } from "../core/account-model.ts";
import { dayWords, lastUsedWords } from "../core/devices-model.ts";
import type { Day } from "../core/devices-model.ts";
import { LINK_WORDS, linkCountWords, linksOf } from "../core/links-model.ts";
import type { SourceLink } from "../core/links-model.ts";
import { call } from "../net/api.ts";
import { dayOf, today } from "../ui/day.ts";
import { el, t, uid } from "../ui/dom.ts";
import { button, h2, note, p, small } from "../ui/kit.ts";
import { focusMessage, hasMessage, messageNodes, NO_MESSAGES, plateOnly } from "./account-messages.ts";
import type { Messages } from "./account-messages.ts";
import { serverFault } from "./errors.ts";
import type { SignedInEnv } from "./signed-in.ts";

const readable = (list: readonly SourceLink[]): boolean => list.every((l) => dayOf(l.linkedAt) !== null && (l.lastUsedAt === null || dayOf(l.lastUsedAt) !== null));

/** Shows the Linked apps page in `box` for the body of `GET source-links`. A body it does not understand is the server fault. */
export function linksPage(main: HTMLElement, box: HTMLElement, body: unknown, env: SignedInEnv, reload: () => void): void {
  const first = linksOf(body);
  if (first === null || !readable(first)) return serverFault(main, reload);
  let list: SourceLink[] = first;
  let open: string | null = null;
  let busy = false;
  let messages: Messages = NO_MESSAGES;
  let revoked: string | null = null;

  const host = {
    env,
    get: () => messages,
    set: (m: Messages) => {
      [messages, revoked] = [m, null];
      draw(null);
      focusMessage(main, box);
    },
    readAgain: (m: Messages) => void readAgain(m),
  };

  // Already revoked or gone (404): the list is read again, so the page shows what is there.
  async function readAgain(after: Messages): Promise<void> {
    const a = await call("GET", "source-links");
    if (!env.current()) return;
    if (a.kind === "not_signed_in") return env.sessionEnded();
    const fresh = a.kind === "ok" ? linksOf(a.body) : null;
    if (fresh === null || !readable(fresh)) {
      const o = outcomeOf(a);
      return host.set(plateOnly(o.kind === "plate" ? o.plate : { kind: "server" }));
    }
    [list, open] = [fresh, null];
    host.set(after);
  }

  async function revoke(l: SourceLink): Promise<void> {
    if (busy) return;
    busy = true;
    for (const b of box.querySelectorAll<HTMLButtonElement>(".ac-panel button")) b.disabled = true;
    const at = list.indexOf(l);
    const o = outcomeOf(await call("DELETE", `source-links/${l.id}`));
    busy = false;
    if (!env.current()) return;
    if (o.kind === "ended") return env.sessionEnded();
    if (o.kind === "gone") return void readAgain(NO_MESSAGES);
    if (o.kind === "plate") return host.set(plateOnly(o.plate));
    list = list.filter((x) => x.id !== l.id);
    [open, messages, revoked] = [null, NO_MESSAGES, l.name];
    // Focus goes to the next row, or the one before when the last went, or the note (site.md, "Keyboard").
    const next = list[Math.min(at, list.length - 1)];
    draw(next ? `[data-link="${next.id}"]` : ".note");
  }

  function row(l: SourceLink, now: Day): HTMLElement {
    const linked = dayOf(l.linkedAt) as Day;
    const used = l.lastUsedAt === null ? null : dayOf(l.lastUsedAt);
    const meta = el("div", { class: "ac-m" }, [LINK_WORDS.linked(dayWords(linked, now)), lastUsedWords(used, now)].map((w) => el("span", {}, [t("small", w, 3)])));
    const act = button(LINK_WORDS.revoke, { onPress: () => ask(l) });
    act.dataset.link = l.id;
    return el("div", { class: "ac-item" }, [el("div", {}, [el("div", { class: "ac-t" }, [t("title", l.name, 3)]), meta]), el("div", { class: "ac-acts" }, [act])]);
  }

  function panel(l: SourceLink): HTMLElement {
    const head = el("div", { class: "ac-t", id: uid("revoke-link") }, [t("title", LINK_WORDS.ask(l.name), 3)]);
    const said = el("div", { class: "ac-m", id: uid("revoke-link-said") }, [el("span", {}, [t("small", LINK_WORDS.consequence, 4)])]);
    const keep = button(LINK_WORDS.keep, { primary: true, onPress: () => cancel(l) });
    keep.dataset.keep = "";
    const go = button(LINK_WORDS.revokeApp, { onPress: () => void revoke(l) });
    const pane = el("div", { class: "ac-item ac-panel panel", role: "alertdialog", "aria-labelledby": head.id, "aria-describedby": said.id }, [el("div", {}, [head, said]), el("div", { class: "ac-acts" }, [keep, go])]);
    pane.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      cancel(l);
    });
    return pane;
  }

  function ask(l: SourceLink): void {
    [open, messages, revoked] = [l.id, NO_MESSAGES, null];
    draw("[data-keep]");
  }

  function cancel(l: SourceLink): void {
    if (busy) return;
    [open, messages] = [null, NO_MESSAGES];
    draw(`[data-link="${l.id}"]`);
  }

  function content(): Node[] {
    const out: Node[] = [h2(LINK_WORDS.heading), ...messageNodes(host)];
    if (revoked !== null) out.push(note(LINK_WORDS.done(revoked), LINK_WORDS.doneDetail));
    if (!list.length) return [...out, p(LINK_WORDS.intro), p(LINK_WORDS.none)];
    // The plain list explains itself; a confirmation or a result shows the rows alone.
    if (open === null && revoked === null && !hasMessage(messages)) out.push(p(LINK_WORDS.intro));
    const now = today();
    out.push(small(linkCountWords(list.length)), el("div", { class: "ac-rows" }, list.map((l) => (l.id === open ? panel(l) : row(l, now)))));
    return out;
  }

  function draw(focus: string | null): void {
    box.replaceChildren(...content());
    if (focus !== null) box.querySelector<HTMLElement>(focus)?.focus();
  }

  draw(null);
}
