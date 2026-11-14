// The devices page (docs/design/site.md, "Devices and pairing"; ADR 0002, section 6): the list,
// and revoking one in place. The confirmation replaces the row: "Keep it" first and focused, Esc
// cancels and returns focus to the row's "Revoke". Names, platforms and versions are the app's
// text, set as text only.
import { countWords, devicesOf, lastUsedWords, pairedWords, platformWords, revokeOutcome, REVOKE_WORDS } from "../core/devices-model.ts";
import type { Day, Device, DevicePlate } from "../core/devices-model.ts";
import { pairPlateWords } from "../core/pairing-model.ts";
import { call } from "../net/api.ts";
import { el, t, uid } from "../ui/dom.ts";
import { button, buttons, h2, note, p, plate } from "../ui/kit.ts";
import { linkButton, serverFault } from "./errors.ts";
import type { SignedInEnv } from "./signed-in.ts";
import "./devices.css";

/** The calendar day of an instant in the page's own time zone, or null for a date it cannot read. */
function dayOf(iso: string): Day | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

const today = (): Day => {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
};

const readable = (list: readonly Device[]): boolean => list.every((d) => dayOf(d.pairedAt) !== null && (d.lastUsedAt === null || dayOf(d.lastUsedAt) !== null));

/** Shows the page for the body of `GET devices`. A body it does not understand is the server fault. */
export function devicesPage(main: HTMLElement, body: unknown, env: SignedInEnv, focusHeading: boolean, reload: () => void): void {
  const first = devicesOf(body);
  if (first === null || !readable(first)) return serverFault(main, reload);
  let list: Device[] = first;
  let open: string | null = null;
  let busy = false;
  let shownPlate: DevicePlate | null = null;
  let revoked: string | null = null;

  async function revoke(d: Device): Promise<void> {
    if (busy) return;
    busy = true;
    for (const b of main.querySelectorAll<HTMLButtonElement>(".dev-panel button")) b.disabled = true;
    const outcome = revokeOutcome(await call("DELETE", `devices/${d.id}`));
    busy = false;
    if (!env.current()) return;
    if (outcome === "ended") return env.sessionEnded();
    if (outcome === "gone") return void readAgain();
    if (outcome === "revoked") {
      list = list.filter((x) => x.id !== d.id);
      [open, shownPlate, revoked] = [null, null, d.name];
      return draw(".note");
    }
    shownPlate = outcome;
    draw(".plate");
  }

  // Already revoked or gone (404): the list is read again, so the page shows what is there.
  async function readAgain(): Promise<void> {
    const a = await call("GET", "devices");
    if (!env.current()) return;
    if (a.kind === "not_signed_in") return env.sessionEnded();
    const fresh = a.kind === "ok" ? devicesOf(a.body) : null;
    if (fresh === null || !readable(fresh)) {
      shownPlate = a.kind === "too_many" ? { kind: "too-many", retryAfter: a.retryAfter } : a.kind === "offline" ? { kind: "offline" } : { kind: "server" };
      return draw(".plate");
    }
    [list, open, shownPlate, revoked] = [fresh, null, null, null];
    draw("h1");
  }

  function row(d: Device, now: Day): HTMLElement {
    const paired = dayOf(d.pairedAt) as Day;
    const used = d.lastUsedAt === null ? null : dayOf(d.lastUsedAt);
    const meta = el("div", { class: "dev-m" }, [platformWords(d), pairedWords(paired, now), lastUsedWords(used, now)].map((w) => el("span", {}, [t("small", w, 3)])));
    const revokeBtn = button("Revoke", { onPress: () => ask(d) });
    revokeBtn.dataset.device = d.id;
    return el("div", { class: "dev-item" }, [el("div", {}, [el("div", { class: "dev-t" }, [t("title", d.name, 3)]), meta]), el("div", { class: "dev-acts" }, [revokeBtn])]);
  }

  function panel(d: Device): HTMLElement {
    const head = el("div", { class: "dev-t", id: uid("revoke") }, [t("title", REVOKE_WORDS.ask(d.name), 3)]);
    const said = el("div", { class: "dev-m", id: uid("revoke-said") }, [el("span", {}, [t("small", REVOKE_WORDS.consequence, 4)])]);
    const keep = button("Keep it", { primary: true, onPress: () => cancel(d) });
    keep.dataset.keep = "";
    const go = button("Revoke device", { onPress: () => void revoke(d) });
    const box = el("div", { class: "dev-item dev-panel panel", role: "alertdialog", "aria-labelledby": head.id, "aria-describedby": said.id }, [el("div", {}, [head, said]), el("div", { class: "dev-acts" }, [keep, go])]);
    box.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      cancel(d);
    });
    return box;
  }

  function ask(d: Device): void {
    [open, shownPlate, revoked] = [d.id, null, null];
    draw("[data-keep]");
  }

  function cancel(d: Device): void {
    if (busy) return;
    [open, shownPlate] = [null, null];
    draw(`[data-device="${d.id}"]`);
  }

  function heading(): HTMLHeadingElement {
    const h = el("h1", {}, [t("h1", "Devices", 3), list.length ? " " : null, list.length ? el("span", { class: "dev-count" }, [t("small", countWords(list.length), 2)]) : null]);
    h.tabIndex = -1;
    return h;
  }

  function content(): Node[] {
    const out: Node[] = [heading()];
    if (shownPlate) out.push(plate(pairPlateWords(shownPlate).head, pairPlateWords(shownPlate).detail));
    if (revoked !== null) out.push(note(REVOKE_WORDS.done(revoked), REVOKE_WORDS.doneDetail));
    if (!list.length) {
      out.push(h2("No devices yet"), p("Open the player on your computer, choose Pair this computer, and type the code it shows."), buttons(linkButton("Enter a code", "/pair", true)));
      return out;
    }
    // The plain list explains itself and offers pairing; a confirmation or a result shows the rows alone.
    if (revoked === null && open === null && shownPlate === null) out.push(p("A device is a computer running the player, paired to your account. It gets your classes and keeps them for offline use."), buttons(linkButton("Pair a device", "/pair", true)));
    const now = today();
    out.push(el("div", { class: "dev-rows" }, list.map((d) => (d.id === open ? panel(d) : row(d, now)))));
    return out;
  }

  function draw(focus: string | null): void {
    main.replaceChildren(...content());
    if (focus !== null) main.querySelector<HTMLElement>(focus)?.focus();
  }

  draw(focusHeading ? "h1" : null);
}
