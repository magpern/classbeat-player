// The keys (docs/design/companion.md, "Keys"): the contract's six actions, each a button that says
// what the press does. Pause, the nudges and Undo fire on one touch; Start, Resume and skip only
// after a 0.8 s hold (core/hold.ts). A greyed or sending key sends nothing. Every key carries
// data-action (and a nudge its data-delta) so the checks can hold the list to the contract.
import { el } from "../../room/dom.ts";
import { SHORT_TAP_HINT_MS, due, lifted, moved, progress, shortTapHint, startHold } from "../core/hold.ts";
import type { Hold } from "../core/hold.ts";
import type { KeyModel, KeysModel, NoticeModel } from "../core/keys.ts";
import type { Delta } from "../core/session.ts";
import type { Action } from "../core/state-check.ts";

export interface KeyHandlers {
  press(action: Action, deltaMs?: Delta): void;
  now(): number;
  reducedMotion(): boolean;
}

const KEEP_HOLDING = "Keep holding";

function holdKey(b: HTMLButtonElement, k: KeyModel, h: KeyHandlers): void {
  const lbl = b.querySelector<HTMLElement>(".kl");
  const hint = b.querySelector<HTMLElement>(".kh");
  const bar = el("span", { class: "prog" });
  b.append(bar);
  let hold: Hold | null = null;
  let frame = 0;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  const show = (): void => {
    const p = hold ? progress(hold, h.now(), h.reducedMotion()) : 0;
    b.classList.toggle("holding", !!hold && !hold.cancelled);
    bar.style.setProperty("--p", `${Math.round(p * 100)}%`);
    if (lbl) lbl.textContent = hold && !hold.cancelled ? KEEP_HOLDING : k.label;
  };
  const loop = (): void => {
    if (!hold) return;
    const r = due(hold, h.now());
    hold = r.hold;
    if (r.fire) {
      (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(30);
      h.press(k.action, k.deltaMs);
    }
    show();
    if (!hold.fired && !hold.cancelled) frame = requestAnimationFrame(loop);
  };
  const begin = (): void => {
    const r = b.getBoundingClientRect();
    hold = startHold(h.now(), { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(loop);
    show();
  };
  const end = (): void => {
    if (!hold) return;
    const out = lifted(hold);
    hold = null;
    cancelAnimationFrame(frame);
    show();
    if (out === "short" && hint && (k.action === "start" || k.action === "resume" || k.action === "skip")) {
      hint.textContent = shortTapHint(k.action);
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        hint.textContent = k.hint;
      }, SHORT_TAP_HINT_MS);
    }
  };
  b.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    b.setPointerCapture?.(e.pointerId);
    begin();
  });
  b.addEventListener("pointermove", (e) => {
    if (hold) hold = moved(hold, e.clientX, e.clientY);
    if (hold?.cancelled) show();
  });
  b.addEventListener("pointerup", end);
  b.addEventListener("pointercancel", () => {
    if (hold) hold = { ...hold, cancelled: true };
    end();
  });
  // From a keyboard: the key held down is the thumb on the key.
  b.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
      e.preventDefault();
      begin();
    }
  });
  b.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") end();
  });
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}

export function renderKey(k: KeyModel, h: KeyHandlers): HTMLButtonElement {
  const cls = ["key", k.main && "main", !k.live && "dis", k.full && "full"].filter(Boolean).join(" ");
  const b = el("button", { class: cls }, [el("span", { class: "kl", tier: "minor", lines: 2, text: k.label }), ...(k.hint ? [el("span", { class: "kh", tier: "label", lines: 2, text: k.hint })] : [])]);
  b.type = "button";
  b.dataset.action = k.action;
  if (k.deltaMs !== undefined) b.dataset.delta = String(k.deltaMs);
  if (k.hold) b.dataset.guard = "hold";
  if (!k.live) b.setAttribute("aria-disabled", "true");
  if (k.sending) b.setAttribute("aria-busy", "true");
  // A greyed or sending key does nothing: no command is made for it.
  if (!k.live || k.sending) return b;
  if (k.hold) holdKey(b, k, h);
  else b.addEventListener("click", () => h.press(k.action, k.deltaMs));
  return b;
}

function renderNotice(n: NoticeModel, h: KeyHandlers): HTMLElement {
  const nt = el("div", { class: "nt" }, [el("span", { class: "h", tier: "minor", lines: 3, text: n.head }), ...(n.detail ? [el("span", { class: "dt", tier: "label", lines: 3, text: n.detail })] : [])]);
  const box = el("div", { class: "notice" }, [nt, ...(n.undo ? [renderKey(n.undo, h)] : [])]);
  box.setAttribute("role", "status");
  return box;
}

export function renderKeys(m: KeysModel, h: KeyHandlers): HTMLElement {
  const nav = el("nav", { class: "keys" });
  nav.setAttribute("aria-label", "Steer the class");
  if (m.kind === "msg") {
    nav.append(el("div", { class: "msg" }, [el("span", { tier: "minor", lines: 2, text: m.text })]));
    return nav;
  }
  for (const k of m.keys) nav.append(renderKey(k, h));
  if (m.notice) nav.append(renderNotice(m.notice, h));
  return nav;
}
