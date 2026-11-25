// The update notice on the class list and the Settings page (docs/design/updates.md). It asks the
// shell for the update status twice a second and shows what comes back; a null answer means a class
// is open (the class gate, ADR 0014 section 3): then there is no notice and no Settings key, and an
// open Settings page goes back to the list. The bridge has five calls and nothing else (ADR 0014
// section 5): the status, Check now, Open release page (no argument) and the two switches, one
// boolean each. The page never holds an address, a path or a feed setting.
import type { UpdateView } from "../core/update/view.ts";
import { noticeWords, settingsWords } from "../core/update/words.ts";
import { shortcut } from "./list-paint.ts";
import { noticeWhatEl, openButtonEl, paintFact, paintMarker, paintSwitch, setText } from "./update-paint.ts";

interface UpdateApi {
  updateStatus(): Promise<UpdateView | null>;
  checkForUpdate(): Promise<UpdateView | null>;
  openReleasePage(): Promise<unknown>;
  setAutomaticChecks(on: boolean): Promise<UpdateView | null>;
  setPrereleases(on: boolean): Promise<UpdateView | null>;
}

export interface UpdatesUi {
  /** The class list was painted; `clear`: no plate and no panel, so the notice may show. */
  listPainted(clear: boolean): void;
}

const POLL_MS = 500;
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

export function updatesUi(): UpdatesUi {
  const api = (window as unknown as { player: UpdateApi }).player;
  const list = $("app");
  const page = $("settings-app");
  const keys = $("head-keys");
  const key = $("settings-key");
  const notice = $("update-notice");
  const sStatus = $("u-status");
  const check = $("u-check");
  const auto = $("u-auto");
  const pre = $("u-pre");
  let status: UpdateView | null = null;
  let clear = false;
  let open = false;
  let shownNotice = "";

  const releasePage = (): void => void api.openReleasePage().catch(() => undefined);
  const pageOpen = openButtonEl(releasePage);
  const take = (v: UpdateView | null): void => {
    status = v;
    paint();
  };
  const ask = (p: Promise<UpdateView | null>): void => void p.then(take, () => undefined);

  function paintNotice(): void {
    const n = clear && status !== null ? noticeWords(status) : null;
    const sig = n === null ? "" : JSON.stringify(n);
    if (sig === shownNotice) return;
    shownNotice = sig;
    const hadFocus = notice.contains(document.activeElement);
    if (n === null) {
      notice.replaceChildren();
      notice.hidden = true;
      return;
    }
    const button = openButtonEl(releasePage);
    notice.replaceChildren(noticeWhatEl(n), button);
    notice.hidden = false;
    if (hadFocus) button.focus();
  }

  function paintSettings(v: UpdateView): void {
    const w = settingsWords(v);
    paintMarker($("u-mark"), w.status.marker);
    setText($("u-st"), w.status.words);
    setText($("u-dt"), w.status.detail);
    if (w.open && !pageOpen.isConnected) sStatus.append(pageOpen);
    else if (!w.open && pageOpen.isConnected) {
      const hadFocus = document.activeElement === pageOpen;
      pageOpen.remove();
      if (hadFocus) check.focus();
    }
    paintFact($("u-current"), w.current);
    paintFact($("u-latest"), w.latest);
    // Dimmed while a check runs, but kept in the tab order so the focus stays on it.
    if (w.busy) check.setAttribute("aria-disabled", "true");
    else check.removeAttribute("aria-disabled");
    paintSwitch(auto, w.auto);
    paintSwitch(pre, w.prereleases);
  }

  function paint(): void {
    if (status === null) {
      if (open) close(false);
      // Absent, not disabled, while a class is open.
      key.remove();
    } else {
      if (!key.isConnected) keys.prepend(key);
      paintSettings(status);
    }
    paintNotice();
  }

  function openSettings(): void {
    if (status === null || open) return;
    open = true;
    list.hidden = true;
    page.hidden = false;
    (pageOpen.isConnected ? pageOpen : check).focus();
  }
  function close(focusKey: boolean): void {
    open = false;
    page.hidden = true;
    list.hidden = false;
    if (focusKey && key.isConnected) key.focus();
  }

  function toggle(which: "auto" | "pre"): void {
    if (status === null) return;
    ask(which === "auto" ? api.setAutomaticChecks(!status.auto) : api.setPrereleases(!status.prereleases));
  }
  for (const [el, which] of [[auto, "auto"], [pre, "pre"]] as const) {
    el.addEventListener("click", () => toggle(which));
    el.addEventListener("keydown", (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      toggle(which);
    });
  }
  check.addEventListener("click", () => {
    // A second press while checking does nothing.
    if (check.getAttribute("aria-disabled") !== "true") ask(api.checkForUpdate());
  });
  key.addEventListener("click", openSettings);
  $("settings-back").addEventListener("click", () => close(true));
  $("settings-kbd").textContent = shortcut("Ctrl+,");
  // Before the class list's own keys: Esc on Settings goes back and closes nothing on the hidden list.
  window.addEventListener(
    "keydown",
    (e) => {
      if (open && e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close(true);
      } else if (!open && status !== null && e.key === "," && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        openSettings();
      }
    },
    true,
  );

  key.remove();
  setInterval(() => ask(api.updateStatus()), POLL_MS);
  ask(api.updateStatus());

  return {
    listPainted(c) {
      if (c === clear) return;
      clear = c;
      paintNotice();
    },
  };
}
