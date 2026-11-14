// The control band (docs/design/play.md, "Controls and keys"): draws what band-view.ts says, asks
// band-model.ts when it shows and hides, and turns presses and keys into the page's fixed commands.
// Every decision is in those pure modules; this file only owns the DOM, its events and its timers.
import type { Status } from "../../../player/app/src/core/clock/clock.ts";
import * as M from "./band-model.ts";
import type { BandContext, BandState } from "./band-model.ts";
import { bandView } from "./band-view.ts";
import type { Action, BandView, ButtonView } from "./band-view.ts";
import { waitsForQuestion } from "./keys.ts";
import type { KeyAction } from "./keys.ts";
import { mainCommand } from "./session.ts";
import type { Command } from "./session.ts";

export interface BandHost {
  command(c: Command): void;
  /** End class and Close class: the class is dropped from memory and the picker shows. */
  endClass(): void;
}

export interface Band {
  /** The clock's status changed (or the first one): redraws, and pins or unpins the band. */
  status(s: Status): void;
  /** A key that means something to the band or the clock; null for any other key, which only restarts the 3 s. */
  handleKey(a: KeyAction | null): void;
  destroy(): void;
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
  e.dataset.action = b.action;
  e.append(make("span", "w", b.word, "minor"));
  if (b.sub) e.append(make("span", "sub", b.sub, "label"));
  return e;
}

function draw(band: HTMLElement, v: BandView): void {
  band.replaceChildren();
  if (v.mode === "finished") return void band.append(buttonEl(v.close, "main quit"));
  if (v.mode === "ask") {
    const ask = make("div", "ask");
    ask.append(make("span", "q", v.question, "minor"), buttonEl(v.endClass, ""), make("span", "gap"), buttonEl(v.keepGoing, "main quit"));
    return void band.append(ask);
  }
  const transport = make("div", "transport");
  transport.append(buttonEl(v.previous, ""), buttonEl(v.main, "main"), buttonEl(v.next, ""));
  band.append(transport, buttonEl(v.end, "quit"));
}

export function mountBand(host: HTMLElement, h: BandHost, opts: { readonly reducedMotion: boolean }): Band {
  const band = make("nav", "controls");
  band.setAttribute("aria-label", "Class controls");
  host.append(band);

  let state: BandState = M.HIDDEN;
  let current: Status = "ready";
  let tabbing = false;
  let swallow = false;
  let drawn = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let askTimer: ReturnType<typeof setTimeout> | undefined;
  const now = (): number => performance.now();
  const ctx = (): BandContext => ({ pinned: M.isPinned(current), fadeMs: opts.reducedMotion ? 0 : M.FADE_MS });

  function render(): void {
    band.dataset.phase = state.phase;
    document.body.dataset.band = state.phase;
    const v = bandView(current, state.asking);
    const key = JSON.stringify(v);
    if (key === drawn) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.action;
    draw(band, v);
    drawn = key;
    if (focused) band.querySelector<HTMLElement>(`[data-action="${focused}"]`)?.focus();
  }

  function schedule(): void {
    clearTimeout(timer);
    const at = M.nextChangeAt(state, ctx());
    if (at !== null) timer = setTimeout(update, Math.max(0, at - now()));
  }

  function set(next: BandState): void {
    const wasHidden = state.phase === "hidden";
    state = M.tick(next, now(), ctx());
    // The band leaves with the focus in it: a hidden band takes no keys.
    if (state.phase === "hidden" && !wasHidden && band.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
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
    if (current === "ended") return set(M.reveal(state, now()));
    set(M.asking(state, true, now()));
    band.querySelector<HTMLElement>('[data-action="keep-going"]')?.focus();
    clearTimeout(askTimer);
    askTimer = setTimeout(closeAsk, M.ASK_TIMEOUT_MS);
  }

  function act(action: Action): void {
    if (action === "start" || action === "pause" || action === "resume" || action === "next" || action === "previous") h.command(action);
    else if (action === "end") openAsk();
    else if (action === "keep-going") closeAsk();
    else {
      clearTimeout(askTimer);
      h.endClass();
    }
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

  // A tap or press with the pointer. One that finds the band hidden or fading only shows it.
  const onPointerDown = (e: PointerEvent): void => {
    if (state.asking && !band.contains(e.target as Node)) closeAsk();
    const r = M.press(state, now(), ctx());
    swallow = !r.pressed;
    set(r.state);
    // A pointer press never counts as keyboard focus.
    if (band.contains(document.activeElement) && !state.asking) (document.activeElement as HTMLElement).blur();
    if (swallow) e.preventDefault();
  };
  const onClick = (e: MouseEvent): void => {
    const target = (e.target as HTMLElement | null)?.closest?.<HTMLButtonElement>("button[data-action]");
    const fromKeyboard = e.detail === 0;
    const pressed = fromKeyboard ? M.takesPresses(state, ctx()) : !swallow;
    swallow = false;
    e.preventDefault();
    if (!target || !band.contains(target) || !pressed) return;
    act(target.dataset.action as Action);
    if (!fromKeyboard && !state.asking) target.blur();
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== "touch") set(M.pointerMove(state, e.clientX, e.clientY, now()));
  };
  // No swipe, long press or double tap does anything.
  const noDefault = (e: Event): void => e.preventDefault();
  const onFocusIn = (): void => {
    if (tabbing) set(M.tabFocus(state, true, now()));
  };
  const onFocusOut = (e: FocusEvent): void => {
    if (!band.contains(e.relatedTarget as Node | null)) set(M.tabFocus(state, false, now()));
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("contextmenu", noDefault);
  document.addEventListener("dblclick", noDefault);
  band.addEventListener("focusin", onFocusIn);
  band.addEventListener("focusout", onFocusOut);

  set(state);
  return {
    status(s) {
      current = s;
      // Leaving the question's state (the class ended) closes it.
      if (state.asking && s === "ended") closeAsk();
      update();
    },
    handleKey(a) {
      const t = now();
      if (a === null) return set(M.keyPress(state, t));
      if (state.asking && waitsForQuestion(a)) return set(M.keyPress(state, t));
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
          const c = mainCommand(current);
          if (c) h.command(c);
          break;
        }
        case "start-only":
          if (current === "ready") h.command("start");
          break;
        case "next":
        case "previous":
          h.command(a.kind);
          break;
        case "jump":
          h.command(a.delta === "forward" ? "forward" : "back");
          break;
        case "ignore":
          break;
      }
      set(M.keyPress(state, t));
    },
    destroy() {
      clearTimeout(timer);
      clearTimeout(askTimer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("contextmenu", noDefault);
      document.removeEventListener("dblclick", noDefault);
      delete document.body.dataset.band;
      band.remove();
    },
  };
}
