// The room screen's control band and keys (room-2d.md, "Controls on the room screen"): draws what
// core/room/band-view.ts says, asks core/room/band-model.ts when it shows and hides, and turns
// presses and keys (core/room/keys.ts) into the room's fixed commands. Every decision is in those
// pure modules; this file only owns the page, its events and its timers.
import * as M from "../core/room/band-model.ts";
import type { BandContext, BandState } from "../core/room/band-model.ts";
import { bandView, mainCommand } from "../core/room/band-view.ts";
import type { BandView, ButtonId, ButtonView, ClockStatus } from "../core/room/band-view.ts";
import type { RoomCommand } from "../core/room/commands.ts";
import type { RoomFrame } from "../core/room/frame.ts";
import { keyAction } from "../core/room/keys.ts";
import { REMOTE_ABSENT } from "../core/room/remote.ts";
import type { RemoteView } from "../core/room/remote.ts";
import { qrSvg } from "./room-qr.ts";

export interface BandHost {
  command(c: RoomCommand): void;
  endClass(): void;
  startRemote(): void;
}

export interface BandOptions {
  /** One display: the band stays in sight before the start and on "Class Complete". */
  readonly alone: () => boolean;
  readonly reducedMotion: boolean;
}

export interface Band {
  frame(f: RoomFrame): void;
  remote(v: RemoteView): void;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string, tier?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (tier) e.dataset.tier = tier;
  return e;
}

function buttonEl(b: ButtonView, cls: string): HTMLButtonElement {
  const e = make("button", `btn ${cls}`.trim());
  e.type = "button";
  e.dataset.id = b.id;
  e.disabled = b.disabled;
  e.append(make("span", "w", b.word, "control"));
  if (b.sub) e.append(make("span", "sub", b.sub, "label"));
  return e;
}

function draw(band: HTMLElement, v: BandView): void {
  band.replaceChildren();
  if (v.mode === "finished") {
    const wrap = make("div", "finished");
    wrap.append(buttonEl(v.close, "quit"));
    band.append(wrap);
    return;
  }
  if (v.mode === "ask") {
    const ask = make("div", "ask");
    ask.append(make("span", "q", v.question, "text"), buttonEl(v.endClass, ""), make("span", "gap"), buttonEl(v.keepGoing, "quit"));
    band.append(ask);
    return;
  }
  const transport = make("div", "transport");
  for (const b of v.transport) transport.append(buttonEl(b, b.id === "main" ? "main" : ""));
  band.append(transport);
  if (v.remote) band.append(buttonEl(v.remote, "phone"));
  if (v.code) {
    const code = make("div", "code");
    const qr = v.code.address ? qrSvg(v.code.address) : null;
    if (qr) code.append(qr);
    const t = make("div", "code-t");
    t.append(make("span", "lbl", "Class code", "label"), make("span", "v", v.code.code, "minor"), make("span", "dt", v.code.line, "label"));
    code.append(t);
    band.append(code);
  }
  band.append(buttonEl(v.end, "quit"));
}

export function mountBand(host: HTMLElement, h: BandHost, opts: BandOptions): Band {
  const band = make("div", "band");
  band.setAttribute("role", "toolbar");
  band.setAttribute("aria-label", "Class controls");
  host.append(band);

  let state: BandState = M.HIDDEN;
  let frame: RoomFrame | null = null;
  let slot: RemoteView = REMOTE_ABSENT;
  // "Phone remote ended" shows until the band next hides.
  let endedNoted = false;
  let tabbing = false;
  let swallow = false;
  let drawn = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let askTimer: ReturnType<typeof setTimeout> | undefined;
  const now = (): number => performance.now();
  const status = (): ClockStatus | null => (frame?.view?.status as ClockStatus | undefined) ?? null;
  const ctx = (): BandContext => ({ pinned: M.isPinned(opts.alone(), status()), fadeMs: opts.reducedMotion ? 0 : M.FADE_MS });

  function render(): void {
    const st = status();
    band.dataset.phase = state.phase;
    document.body.dataset.band = state.phase;
    if (st === null) {
      band.replaceChildren();
      drawn = "";
      return;
    }
    const shownSlot: RemoteView = slot.slot === "available" && slot.note === "ended" && !endedNoted ? { slot: "available", note: "none" } : slot;
    const v = bandView(st, frame?.band ?? null, shownSlot, state.asking);
    const key = JSON.stringify(v);
    if (key === drawn) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.id;
    draw(band, v);
    drawn = key;
    if (focused) band.querySelector<HTMLElement>(`[data-id="${focused}"]`)?.focus();
  }

  function schedule(): void {
    clearTimeout(timer);
    const at = M.nextChangeAt(state, ctx());
    if (at !== null) timer = setTimeout(update, Math.max(0, at - now()));
  }

  function set(next: BandState): void {
    const wasHidden = state.phase === "hidden";
    state = M.tick(next, now(), ctx());
    if (state.phase === "hidden" && !wasHidden) {
      endedNoted = false;
      if (band.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    }
    render();
    schedule();
  }
  const update = (): void => set(state);

  function closeAsk(): void {
    clearTimeout(askTimer);
    if (!state.asking) return;
    set(M.asking(state, false, now()));
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  function openAsk(): void {
    if (status() === "ended" || status() === null) return set(M.reveal(state, now()));
    set(M.asking(state, true, now()));
    band.querySelector<HTMLElement>('[data-id="keep-going"]')?.focus();
    clearTimeout(askTimer);
    askTimer = setTimeout(closeAsk, M.ASK_TIMEOUT_MS);
  }

  function act(id: ButtonId): void {
    const st = status();
    if (id === "main" && st) {
      const c = mainCommand(st);
      if (c) h.command({ type: c });
    } else if (id === "next" || id === "previous") h.command({ type: id });
    else if (id === "end") openAsk();
    else if (id === "keep-going") closeAsk();
    else if (id === "end-class" || id === "close") {
      clearTimeout(askTimer);
      h.endClass();
    } else if (id === "remote") h.startRemote();
  }

  function moveFocus(back: boolean): void {
    const buttons = [...band.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = at === -1 ? (back ? buttons.length - 1 : 0) : (at + (back ? -1 : 1) + buttons.length) % buttons.length;
    tabbing = true;
    buttons[next]!.focus();
    tabbing = false;
  }

  // A press with the pointer or a tap. One that finds the band hidden or fading only shows it.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (state.asking && !band.contains(e.target as Node)) closeAsk();
      const r = M.press(state, now(), ctx());
      swallow = !r.pressed;
      set(r.state);
      // A pointer press never counts as keyboard focus.
      if (band.contains(document.activeElement) && !state.asking) (document.activeElement as HTMLElement).blur();
      if (swallow) e.preventDefault();
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      const target = (e.target as HTMLElement | null)?.closest?.<HTMLButtonElement>("button[data-id]");
      const fromKeyboard = e.detail === 0;
      const pressed = fromKeyboard ? M.takesPresses(state, ctx()) : !swallow;
      swallow = false;
      e.preventDefault();
      if (!target || !band.contains(target) || !pressed || target.disabled) return;
      act(target.dataset.id as ButtonId);
      if (!fromKeyboard && !state.asking) target.blur();
    },
    true,
  );
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    set(M.pointerMove(state, e.clientX, e.clientY, now()));
  });
  // No swipe, long press or double tap does anything.
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault());

  band.addEventListener("focusin", () => {
    if (tabbing) set(M.tabFocus(state, true, now()));
  });
  band.addEventListener("focusout", (e) => {
    if (!band.contains(e.relatedTarget as Node | null)) set(M.tabFocus(state, false, now()));
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === " ") e.preventDefault();
  });
  window.addEventListener("keydown", (e) => {
    const a = keyAction({ key: e.key, shift: e.shiftKey, mod: e.ctrlKey || e.metaKey, alt: e.altKey, repeat: e.repeat });
    const t = now();
    if (a === null) return set(M.keyPress(state, t));
    e.preventDefault();
    const st = status();
    switch (a.kind) {
      case "tab":
        set(M.reveal(state, t));
        return moveFocus(a.back);
      case "escape":
        if (state.asking) return closeAsk();
        (document.activeElement as HTMLElement | null)?.blur?.();
        return set(M.escape(state, t, ctx()));
      case "end":
        return openAsk();
      case "main": {
        const c = st ? mainCommand(st) : null;
        if (c) h.command({ type: c });
        break;
      }
      case "start-only":
        if (st === "ready") h.command({ type: "start" });
        break;
      case "next":
      case "previous":
      case "undo":
        if (st) h.command({ type: a.kind });
        break;
      case "jump":
        if (st) h.command({ type: "jump", deltaMs: a.deltaMs });
        break;
      case "follow":
        // Only where the music could be followed; otherwise F does nothing.
        if (frame?.link?.available === true) h.command({ type: "follow" });
        break;
      case "ignore":
        break;
    }
    set(M.keyPress(state, t));
  });

  set(state);
  return {
    frame(f) {
      frame = f;
      update();
    },
    remote(v) {
      if (v.slot === "available" && v.note === "ended" && !(slot.slot === "available" && slot.note === "ended")) endedNoted = true;
      slot = v;
      update();
    },
  };
}
