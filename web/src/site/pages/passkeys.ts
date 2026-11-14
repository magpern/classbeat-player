// Account: Passkeys (docs/design/site.md, "Account"; ADR 0002, sections 4 and 6): the list, adding
// one by the browser's prompt, renaming and removing in place, and the limit of 10. Adding and
// removing need a recent sign-in: a 403 shows "Confirm it is you" and nothing is sent again by
// itself. The registration's challenge and attestation never leave net/passkey-add.ts.
import { outcomeOf } from "../core/account-model.ts";
import { nameOf } from "../core/pairing-model.ts";
import { afterAdd, afterRename, atLimit, countWords, PASSKEY_WORDS, passkeysOf } from "../core/passkeys-model.ts";
import type { Passkey } from "../core/passkeys-model.ts";
import { call } from "../net/api.ts";
import { addPasskey, passkeyCreateSupported } from "../net/passkey-add.ts";
import { dayOf, today } from "../ui/day.ts";
import { el, uid } from "../ui/dom.ts";
import { button, buttons, h2, note, p, small, working } from "../ui/kit.ts";
import { focusMessage, hasMessage, messageNodes, NO_MESSAGES, plateOnly } from "./account-messages.ts";
import type { Messages } from "./account-messages.ts";
import { serverFault } from "./errors.ts";
import { addPanel, passkeyRow, removeRow, renameRow } from "./passkey-rows.ts";
import type { AddPanel, RenameRow } from "./passkey-rows.ts";
import type { SignedInEnv } from "./signed-in.ts";

type Mode = { readonly kind: "list" } | ({ readonly kind: "add" } & AddPanel) | ({ readonly kind: "rename"; readonly id: string } & RenameRow) | { readonly kind: "remove"; readonly id: string; readonly busy: boolean };
type Done = { readonly kind: "added" } | { readonly kind: "removed"; readonly name: string } | null;

const LIST: Mode = { kind: "list" };
const readable = (list: readonly Passkey[]): boolean => list.every((k) => dayOf(k.addedAt) !== null && (k.lastUsedAt === null || dayOf(k.lastUsedAt) !== null));

/** Shows the Passkeys page in `box` for the body of `GET passkeys`. A body it does not understand is the server fault. */
export function passkeysPage(main: HTMLElement, box: HTMLElement, body: unknown, env: SignedInEnv, reload: () => void): void {
  const first = passkeysOf(body);
  if (first === null || !readable(first)) return serverFault(main, reload);
  const canAdd = passkeyCreateSupported();
  let list: Passkey[] = first;
  let mode: Mode = LIST;
  let messages: Messages = NO_MESSAGES;
  let done: Done = null;
  let lastName = "";

  const host = {
    env,
    get: () => messages,
    set: (m: Messages) => {
      [messages, done] = [m, null];
      draw(null);
      focusMessage(main, box);
    },
    readAgain: (m: Messages) => void readAgain(m),
  };
  const busy = (): boolean => mode.kind !== "list" && mode.busy;

  async function readAgain(after: Messages): Promise<void> {
    const a = await call("GET", "passkeys");
    if (!env.current()) return;
    if (a.kind === "not_signed_in") return env.sessionEnded();
    const fresh = a.kind === "ok" ? passkeysOf(a.body) : null;
    mode = LIST;
    if (fresh === null || !readable(fresh)) {
      const o = outcomeOf(a);
      return host.set(plateOnly(o.kind === "plate" ? o.plate : { kind: "server" }));
    }
    list = fresh;
    host.set(after);
  }

  async function add(typed: string): Promise<void> {
    if (busy()) return;
    lastName = typed;
    const name = nameOf(typed);
    if (name === null) {
      mode = { kind: "add", typed, nameError: true, busy: false };
      return draw("input[name=name]");
    }
    [mode, messages] = [{ kind: "add", typed, nameError: false, busy: true }, NO_MESSAGES];
    draw(null);
    const next = afterAdd(await addPasskey(name));
    mode = { kind: "add", typed, nameError: false, busy: false };
    if (!env.current()) return;
    if (next.kind === "ended") return env.sessionEnded();
    if (next.kind === "limit") return void readAgain(NO_MESSAGES);
    if (next.kind === "added") {
      list = [...list, next.passkey];
      [mode, messages, done, lastName] = [LIST, NO_MESSAGES, { kind: "added" }, ""];
      return draw(".note");
    }
    // Not added, or asked to confirm it is them: back to the list. A fault keeps the form under the plate.
    if (next.plate.kind === "not-added" || next.plate.kind === "confirm") mode = LIST;
    host.set(plateOnly(next.plate));
  }

  async function rename(k: Passkey, typed: string): Promise<void> {
    if (busy()) return;
    const name = nameOf(typed);
    if (name === null) {
      mode = { kind: "rename", id: k.id, typed, nameError: true, busy: false };
      return draw("input[name=name]");
    }
    [mode, messages, done] = [{ kind: "rename", id: k.id, typed, nameError: false, busy: true }, NO_MESSAGES, null];
    draw(null);
    const next = afterRename(await call("PATCH", `passkeys/${k.id}`, { name }));
    mode = { kind: "rename", id: k.id, typed, nameError: false, busy: false };
    if (!env.current()) return;
    if (next.kind === "ended") return env.sessionEnded();
    if (next.kind === "gone") return void readAgain(NO_MESSAGES);
    if (next.kind === "name-error") {
      mode = { kind: "rename", id: k.id, typed, nameError: true, busy: false };
      return draw("input[name=name]");
    }
    if (next.kind === "plate") return host.set(plateOnly(next.plate));
    list = list.map((x) => (x.id === k.id ? next.passkey : x));
    mode = LIST;
    draw(`[data-row="${k.id}"][data-act="rename"]`);
  }

  async function remove(k: Passkey): Promise<void> {
    if (busy()) return;
    [mode, messages, done] = [{ kind: "remove", id: k.id, busy: true }, NO_MESSAGES, null];
    draw(null);
    const at = list.indexOf(k);
    const o = outcomeOf(await call("DELETE", `passkeys/${k.id}`));
    mode = { kind: "remove", id: k.id, busy: false };
    if (!env.current()) return;
    if (o.kind === "ended") return env.sessionEnded();
    if (o.kind === "gone") return void readAgain(NO_MESSAGES);
    if (o.kind === "plate") {
      if (o.plate.kind === "confirm") mode = LIST;
      return host.set(plateOnly(o.plate));
    }
    list = list.filter((x) => x.id !== k.id);
    [mode, done] = [LIST, { kind: "removed", name: k.name }];
    // Focus goes to the next row, or the one before when the last went (site.md, "Keyboard").
    const next = list[Math.min(at, list.length - 1)];
    draw(next ? `[data-row="${next.id}"][data-act="rename"]` : "[data-add], h1");
  }

  const toList = (focus: string): void => {
    if (busy()) return;
    mode = LIST;
    draw(focus);
  };
  const openAdd = (): void => {
    [mode, messages, done] = [{ kind: "add", typed: lastName, nameError: false, busy: false }, NO_MESSAGES, null];
    draw("input[name=name]");
  };
  const actions = {
    rename: (k: Passkey) => {
      [mode, messages, done] = [{ kind: "rename", id: k.id, typed: k.name, nameError: false, busy: false }, NO_MESSAGES, null];
      draw("input[name=name]");
    },
    remove: (k: Passkey) => {
      [mode, messages, done] = [{ kind: "remove", id: k.id, busy: false }, NO_MESSAGES, null];
      draw("[data-keep]");
    },
  };

  function rowOf(k: Passkey, now: ReturnType<typeof today>): HTMLElement {
    if (mode.kind === "rename" && mode.id === k.id) return renameRow(k, mode, (typed) => void rename(k, typed), () => toList(`[data-row="${k.id}"][data-act="rename"]`));
    if (mode.kind === "remove" && mode.id === k.id) return removeRow(k, mode.busy, () => toList(`[data-row="${k.id}"][data-act="remove"]`), () => void remove(k));
    return passkeyRow(k, now, actions);
  }

  function content(): Node[] {
    const out: Node[] = [h2(PASSKEY_WORDS.heading)];
    const notAdded = messages.plate?.kind === "not-added";
    out.push(...messageNodes(host, notAdded && canAdd ? { text: PASSKEY_WORDS.tryAgain, onPress: openAdd } : undefined));
    if (done?.kind === "added") out.push(note(PASSKEY_WORDS.added, PASSKEY_WORDS.addedDetail));
    if (done?.kind === "removed") out.push(note(PASSKEY_WORDS.removed(done.name), PASSKEY_WORDS.removedDetail));
    if (mode.kind === "add") {
      const waiting = mode.busy ? working(PASSKEY_WORDS.waiting) : null;
      // "You are offline" is described to the add button, as the export's plate is to its button.
      const offline = messages.plate?.kind === "offline" ? out.find((n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains("plate")) : undefined;
      if (offline) offline.id = uid("add-offline");
      return [...out, p(PASSKEY_WORDS.intro), addPanel(mode, (typed) => void add(typed), () => toList("[data-add]"), waiting, offline?.id)];
    }
    const plain = !hasMessage(messages) && done === null && mode.kind === "list";
    if (plain || !list.length) out.push(p(PASSKEY_WORDS.intro));
    if (!list.length) out.push(p(PASSKEY_WORDS.none));
    const full = atLimit(list.length);
    const limit = full ? note(PASSKEY_WORDS.limit, PASSKEY_WORDS.limitDetail) : null;
    if (limit) {
      limit.id = uid("limit");
      out.push(limit);
    }
    if (canAdd && !notAdded) {
      const b = button(PASSKEY_WORDS.add, { primary: true, disabled: full, onPress: openAdd });
      b.dataset.add = "";
      if (limit) b.setAttribute("aria-describedby", limit.id);
      out.push(buttons(b));
    }
    if (list.length) {
      const now = today();
      out.push(small(countWords(list.length)), el("div", { class: "ac-rows" }, list.map((k) => rowOf(k, now))));
    }
    return out;
  }

  function draw(focus: string | null): void {
    box.replaceChildren(...content());
    if (focus === null) return;
    const target = focus.split(", ").map((s) => box.querySelector<HTMLElement>(s) ?? main.querySelector<HTMLElement>(s)).find((e) => e !== null && !(e instanceof HTMLButtonElement && e.disabled));
    target?.focus();
  }

  draw(null);
}
