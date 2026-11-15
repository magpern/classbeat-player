// Account: Your data (docs/design/site.md, "Your data"; ADR 0002, sections 10 and 11): the export,
// handed to the browser to save and kept nowhere by the page, and deleting the account, which asks
// in a panel that replaces the page: "Keep my account" first and focused, Esc keeps it, and the
// typed address goes only in the body of `POST account/delete`. Both need a recent sign-in: a 403
// shows "Confirm it is you" and nothing is sent again by itself.
import { canDelete, CONFIRM_MAX, DATA_WORDS, deleteOutcomeOf, exportOutcomeOf } from "../core/data-model.ts";
import { call } from "../net/api.ts";
import { exportAccount } from "../net/export.ts";
import { el, t, uid } from "../ui/dom.ts";
import { button, buttons, field, h2, note, p, plate, small, working } from "../ui/kit.ts";
import { focusMessage, hasMessage, idOfPlate, messageNodes, NO_MESSAGES, plateOnly } from "./account-messages.ts";
import type { Messages } from "./account-messages.ts";
import { clearDeleted } from "./deleted-note.ts";
import type { SignedInEnv } from "./signed-in.ts";

type ExportView = { readonly kind: "idle" } | { readonly kind: "working" } | { readonly kind: "started" } | { readonly kind: "limit"; readonly retryAfter: number | null };
/** The deletion panel: what was typed, kept in memory only while the panel is open. */
interface Panel {
  readonly typed: string;
  readonly mismatch: boolean;
  readonly busy: boolean;
}

const IDLE: ExportView = { kind: "idle" };

/** Shows the Your data page in `box`. Its first request (`GET sessions`) only shows the person is signed in. */
export function dataPage(main: HTMLElement, box: HTMLElement, env: SignedInEnv): void {
  let exp: ExportView = IDLE;
  let panel: Panel | null = null;
  let messages: Messages = NO_MESSAGES;
  let waitingOnline = false;

  const host = {
    env,
    get: () => messages,
    set: (m: Messages) => {
      messages = m;
      draw(null);
      focusMessage(main, box);
    },
    // Signing in again changes nothing on this page: there is no list to read again.
  };

  async function startExport(): Promise<void> {
    if (exp.kind === "working" || exp.kind === "limit") return;
    [exp, messages] = [{ kind: "working" }, NO_MESSAGES];
    draw(".status");
    const r = await exportAccount(env.current);
    if (r === "dropped" || !env.current()) return;
    if (r === "saved") {
      exp = { kind: "started" };
      return draw(".note");
    }
    const o = exportOutcomeOf(r);
    if (o.kind === "ended") return env.sessionEnded();
    if (o.kind === "limit") {
      exp = { kind: "limit", retryAfter: o.retryAfter };
      return draw(".plate");
    }
    exp = IDLE;
    host.set(plateOnly(o.plate));
    if (o.plate.kind === "offline") retryWhenOnline();
  }

  /** Offline, the export waits: it is asked for again once, when the browser says it is back online. */
  function retryWhenOnline(): void {
    if (waitingOnline) return;
    waitingOnline = true;
    window.addEventListener(
      "online",
      () => {
        waitingOnline = false;
        if (box.isConnected && env.current() && exportOffline()) void startExport();
      },
      { once: true },
    );
  }

  /** "You are offline" heads the page for the export (not for the open deletion panel). */
  const exportOffline = (): boolean => panel === null && messages.plate?.kind === "offline";

  async function remove(typed: string): Promise<void> {
    if (panel === null || panel.busy || !canDelete(typed)) return;
    panel = { typed, mismatch: false, busy: true };
    // Nothing is drawn again while it waits, so focus stays where it is.
    for (const b of box.querySelectorAll<HTMLButtonElement>(".ac-panel button")) b.disabled = true;
    for (const i of box.querySelectorAll<HTMLInputElement>(".ac-panel input")) i.readOnly = true;
    const o = deleteOutcomeOf(await call("POST", "account/delete", { confirm: typed }));
    if (!env.current()) return;
    if (o.kind === "deleted") {
      // A class note held for the list is not carried to whoever signs in next in this browser.
      clearDeleted();
      return env.deleted();
    }
    if (o.kind === "ended") return env.sessionEnded();
    if (o.kind === "mismatch") {
      panel = { typed, mismatch: true, busy: false };
      return draw("input[name=confirm]");
    }
    // Asked to confirm it is them: the panel closes, the address goes with it, and nothing is sent
    // again by itself. Any other refusal keeps the panel open under the plate.
    panel = o.plate.kind === "confirm" ? null : { typed, mismatch: false, busy: false };
    host.set(plateOnly(o.plate));
  }

  function openPanel(): void {
    [panel, messages] = [{ typed: "", mismatch: false, busy: false }, NO_MESSAGES];
    draw("[data-keep]");
  }

  function keep(): void {
    if (panel?.busy) return;
    [panel, messages] = [null, NO_MESSAGES];
    draw("[data-delete-open]");
  }

  function panelOf(v: Panel): HTMLElement {
    const head = el("h2", { id: uid("delete") }, [t("h2", DATA_WORDS.deleteAsk, 3)]);
    const said = el("p", { id: uid("delete-said") }, [t("body", DATA_WORDS.deleteConsequence)]);
    const f = field(DATA_WORDS.emailLabel, { type: "email", name: "confirm", value: v.typed, error: v.mismatch ? DATA_WORDS.mismatch : undefined });
    // Not remembered by the browser's form history: the address is used once and dropped.
    f.input.autocomplete = "off";
    f.input.maxLength = CONFIRM_MAX;
    const kept = button(DATA_WORDS.keep, { primary: true, onPress: keep });
    kept.dataset.keep = "";
    const gone = button(DATA_WORDS.deleteButton, { submit: true, disabled: !canDelete(v.typed) });
    f.input.addEventListener("input", () => {
      gone.disabled = !canDelete(f.input.value);
    });
    const form = el("form", { class: "ac-panel panel", role: "alertdialog", "aria-labelledby": head.id, "aria-describedby": said.id }, [head, said, f.root, buttons(kept, gone)]);
    form.noValidate = true;
    form.method = "post";
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void remove(f.input.value);
    });
    form.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      keep();
    });
    return form;
  }

  function exportNodes(offline: string | null): Node[] {
    const out: Node[] = [h2(DATA_WORDS.exportHeading), p(DATA_WORDS.exportIntro)];
    let limit: HTMLElement | null = null;
    if (exp.kind === "limit") {
      limit = plate(DATA_WORDS.limitHead, DATA_WORDS.limitDetail(exp.retryAfter));
      limit.id = uid("export-limit");
      out.push(limit);
    }
    if (exp.kind === "started") out.push(note(DATA_WORDS.started, DATA_WORDS.startedDetail));
    if (exp.kind === "working") {
      const w = working(DATA_WORDS.exporting);
      w.tabIndex = -1;
      out.push(w);
    }
    const b = button(DATA_WORDS.download, { primary: true, disabled: exp.kind === "working" || exp.kind === "limit" || offline !== null, onPress: () => void startExport() });
    b.dataset.export = "";
    // The disabled button says why in words: the plate (site.md, "Your data" and "Errors").
    const why = limit?.id ?? offline;
    if (why !== null) b.setAttribute("aria-describedby", why);
    out.push(buttons(b));
    if (exp.kind === "idle" && !hasMessage(messages)) out.push(small(DATA_WORDS.limitLine));
    return out;
  }

  function content(): Node[] {
    // A plate or "Confirm it is you" heads the page, so it is in view whichever section asked (S3).
    // Offline, the export waits under "You are offline", whose "Try again" asks for it again.
    const offline = exportOffline();
    const here = messageNodes(host, offline ? { text: DATA_WORDS.tryAgain, onPress: () => void startExport() } : undefined);
    // The panel replaces the page (site.md, "What every page has"); a plate stays above it.
    if (panel !== null) return [...here, panelOf(panel)];
    const open = button(DATA_WORDS.deleteOpen, { onPress: openPanel });
    open.dataset.deleteOpen = "";
    const plateId = offline ? idOfPlate(here, "export-offline") : null;
    return [...here, ...exportNodes(plateId), h2(DATA_WORDS.deleteHeading), p(DATA_WORDS.deleteIntro), buttons(open)];
  }

  function draw(focus: string | null): void {
    box.replaceChildren(...content());
    if (focus !== null) box.querySelector<HTMLElement>(focus)?.focus();
  }

  draw(null);
}
