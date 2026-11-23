// The room screen's control band and keys (room-2d.md, "Controls on the room screen"): draws what
// core/room/band-view.ts says, asks core/room/band-model.ts when it shows and hides, and turns
// presses and keys (core/room/keys.ts) into the room's fixed commands. Every decision is in those
// pure modules; this file only owns the page, its events and its timers.
import * as M from "../core/room/band-model.ts";
import type { BandContext, BandState } from "../core/room/band-model.ts";
import { bandView, mainCommand } from "../core/room/band-view.ts";
import type { ButtonId, ClockStatus } from "../core/room/band-view.ts";
import type { RoomCommand } from "../core/room/commands.ts";
import type { RoomFrame } from "../core/room/frame.ts";
import { keyAction, waitsForQuestion } from "../core/room/keys.ts";
import type { RemoteView } from "../core/room/remote.ts";
import { bandMoved, NO_NOTE, shownSlot, slotArrived } from "../core/room/remote-note.ts";
import type { Marks } from "./room-marks.ts";
import { draw, make } from "./room-band-draw.ts";

export interface BandHost {
  command(c: RoomCommand): void;
  endClass(): void;
  startRemote(): void;
}

export interface BandOptions {
  /** One display: the band stays in sight before the start and on "Class Complete". */
  readonly alone: () => boolean;
  /** Where each visible change of the band falls: a step in its own frame (room-marks.ts). */
  readonly marks: Marks;
  /** The join sheet (room-join.ts): J goes to it, Esc closes it first, and the slot knows it is open. */
  readonly sheet?: { isOpen(): boolean; join(): boolean; escape(): boolean };
}

export interface Band {
  frame(f: RoomFrame): void;
  remote(v: RemoteView): void;
  /** The join sheet opened or closed. */
  redraw(): void;
}

export function mountBand(host: HTMLElement, h: BandHost, opts: BandOptions): Band {
  const band = make("div", "band");
  band.setAttribute("role", "toolbar");
  band.setAttribute("aria-label", "Class controls");
  host.append(band);

  let state: BandState = M.HIDDEN;
  let frame: RoomFrame | null = null;
  // The slot, and whether its "Phone remote ended" or "Can't reach site" is still to show.
  let note = NO_NOTE;
  let tabbing = false;
  let swallow = false;
  // What the page shows, which is the model's `state` as of the last mark it reached the screen in.
  let onScreen = false;
  let drawn = "";
  // Focus that waits for the band to be on screen (Tab or the End question just after it went).
  let focusLater: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let askTimer: ReturnType<typeof setTimeout> | undefined;
  const now = (): number => performance.now();
  const status = (): ClockStatus | null => (frame?.view?.status as ClockStatus | undefined) ?? null;
  const ctx = (): BandContext => ({ pinned: M.isPinned(opts.alone(), status()) });
  /** A press acts only on a band that is on the screen and not counted hidden. */
  const takesPresses = (): boolean => onScreen && M.takesPresses(state, ctx());

  /** Draws the band as the model says: what is on screen after this is what is wanted. Returns whether it changed. */
  function paint(): boolean {
    const st = status();
    const want = state.phase === "shown" && st !== null;
    const v = st === null ? null : bandView(st, frame?.band ?? null, shownSlot(note), state.asking, opts.sheet?.isOpen() ?? false);
    const key = v === null ? "" : JSON.stringify(v);
    let changed = false;
    if (key !== drawn) {
      const focused = (document.activeElement as HTMLElement | null)?.dataset?.id;
      if (v === null) band.replaceChildren();
      else draw(band, v);
      drawn = key;
      changed = want || onScreen;
      if (focused) band.querySelector<HTMLElement>(`[data-id="${focused}"]`)?.focus();
    }
    if (want !== onScreen) {
      onScreen = want;
      changed = true;
    }
    const phase = onScreen ? "shown" : "hidden";
    band.dataset.phase = phase;
    document.body.dataset.band = phase;
    if (onScreen && focusLater) {
      const f = focusLater;
      focusLater = null;
      f();
    }
    return changed;
  }

  /** Whatever the model now says the band should show, in a frame of its own: a step, never a fade. */
  function render(): void {
    const st = status();
    const visibleNow = state.phase === "shown" && st !== null;
    if (!visibleNow && !onScreen) {
      // Out of sight before and after: nothing a person can see changes, so it takes no mark.
      opts.marks.cancel("band");
      focusLater = null;
      paint();
      return;
    }
    opts.marks.request("band", paint);
  }

  function schedule(): void {
    clearTimeout(timer);
    const at = M.nextChangeAt(state, ctx());
    if (at !== null) timer = setTimeout(update, Math.max(0, at - now()));
  }

  function set(next: BandState): void {
    const wasHidden = state.phase === "hidden";
    state = M.tick(next, now(), ctx());
    note = bandMoved(note, wasHidden, state.phase === "hidden");
    if (state.phase === "hidden" && !wasHidden) {
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
    later(() => band.querySelector<HTMLElement>('[data-id="keep-going"]')?.focus());
    clearTimeout(askTimer);
    askTimer = setTimeout(closeAsk, M.ASK_TIMEOUT_MS);
  }

  /** Runs `f` now when the band is on screen (focus needs it), else in the frame that shows it. */
  function later(f: () => void): void {
    if (onScreen) f();
    else focusLater = f;
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

  // A press with the pointer or a tap. One that finds the band hidden only shows it.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (state.asking && !band.contains(e.target as Node)) closeAsk();
      const pressed = takesPresses();
      const r = M.press(state, now(), ctx());
      swallow = !pressed;
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
      const pressed = fromKeyboard ? takesPresses() : !swallow;
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
    if (state.asking && waitsForQuestion(a)) return set(M.keyPress(state, t));
    const st = status();
    switch (a.kind) {
      case "tab":
        set(M.reveal(state, t));
        return later(() => moveFocus(a.back));
      case "escape":
        if (state.asking) return closeAsk();
        if (opts.sheet?.escape() === true) return set(M.keyPress(state, t));
        (document.activeElement as HTMLElement | null)?.blur?.();
        return set(M.escape(state, ctx()));
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
      case "join":
        // The sheet, never the band: J shows nothing else and moves nothing.
        opts.sheet?.join();
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
      note = slotArrived(note, v);
      update();
    },
    redraw: update,
  };
}
