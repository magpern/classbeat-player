// The room screen: mounts into an element and redraws from a snapshot. The only code that owns time,
// and only to place a redraw on a frame mark (mark-gate.ts): between marks nothing on the screen moves,
// there is no transition, no animation and no frame loop (docs/design/room-2d.md, "Motion and reduced
// motion"). Every other decision is in the pure modules.
import { el } from "./dom.ts";
import { toRoomModel } from "./adapter.ts";
import type { RoomInput } from "./input.ts";
import { createMarkGate } from "./mark-gate.ts";
import type { MarkContext, MarkTicket } from "./mark-gate.ts";
import type { RoomModel } from "./model.ts";
import { fitCue } from "./fit-cue.ts";
import { createGel } from "./render-gel.ts";
import { clampTitle, fitTitle, renderIntro } from "./render-intro.ts";
import { allowTwoLines, renderClock, renderCue, renderMetrics, renderNext, renderRail } from "./render-parts.ts";
import { renderScore } from "./render-score.ts";
import { LANDSCAPE_SCALE, layoutOf } from "./score-scale.ts";
import type { ScoreScale } from "./score-scale.ts";

/** The faces the screen measures with (system.md, Type); loaded explicitly so the first fit is not made with a fallback. */
const FONT_FACES = ['600 1em "Big Shoulders Display"', '800 1em "Big Shoulders Display"', '400 1em "Atkinson Hyperlegible"', '700 1em "Atkinson Hyperlegible"'];

export type { MarkTicket };

/** Time as the screen sees it: injected so the checks can run a class on a clock they step by frames. */
export interface RoomClock {
  now(): number;
  later(run: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const REAL_CLOCK: RoomClock = {
  now: () => performance.now(),
  later: (run, delayMs) => setTimeout(run, Math.ceil(delayMs)),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RoomOptions {
  /** The player's own setting passes true; the system's `prefers-reduced-motion` otherwise. The plain screen is the same either way. */
  readonly reducedMotion?: boolean;
  /** False draws every snapshot at once, with no frame marks (screenshots and checks of one state). */
  readonly animate?: boolean;
  /** The score's scale for the layout now on screen (the web player page changes it with the viewport); the room's own when absent. */
  readonly scale?: () => ScoreScale;
  /** Defaults to the page's own clock. */
  readonly clock?: RoomClock;
}

export interface RoomScreen {
  update(input: RoomInput): void;
  /**
   * Asks for a frame mark for a change the shell makes itself on top of the screen (the control band, the join sheet, a
   * plate): `draw` is called when the frame comes, and the frame is returned now, on the clock of `RoomOptions.clock`
   * (`performance.now()` by default). The mark is placed by the same ledger and the same scheduler call as the screen's own
   * marks (flash-marks.ts, P1 fixed frames first, then P2, scene.md "The flash budget"): at least 500 ms from every
   * mark drawn, reserved or pending, so a tick that would fall within 500 ms of it gives way, and at most 500 ms late (1 s
   * when it joins the interval's change frame or the count's switch beat). Call it from the shell's own timers or event
   * handlers, at the time the change is wanted, and draw only inside `draw`: it is called synchronously before this
   * returns when the frame is now (or shares the frame of a draw just made), otherwise from the screen's timer. Every
   * change of the band, the sheet and the plate must go through it; one that is drawn without it breaks the whole
   * window's budget. `cancel` gives the mark up before `draw` has run.
   */
  requestMark(draw: () => void): MarkTicket;
  destroy(): void;
}

export function mountRoom(host: HTMLElement, opts: RoomOptions = {}): RoomScreen {
  const reduced = opts.reducedMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const clock = opts.clock ?? REAL_CLOCK;
  const gate = (opts.animate ?? true) ? createMarkGate() : null;
  if (reduced) document.documentElement.dataset.reducedMotion = "";
  const root = el("div", { class: "room" });
  const gel = createGel();
  const dyn = el("div", { class: "dyn" });
  root.append(gel.element, dyn);
  host.append(root);

  let timer: unknown;

  // The player's window never passes a scale and is always the room's layout; the web page chooses by its viewport.
  const roomLayout = (): boolean => opts.scale === undefined || layoutOf(window.innerWidth, window.innerHeight) === "room";
  const fit = (): void => {
    const h1 = dyn.querySelector<HTMLElement>(".intro h1");
    if (h1) {
      fitTitle(h1);
      if (!roomLayout()) clampTitle(h1);
    }
    allowTwoLines(dyn, !roomLayout());
    fitCue(dyn.querySelector<HTMLElement>(".cue"), !roomLayout());
    gel.fit();
  };
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
  resize?.observe(root);
  // Measure again once the real fonts are in: fonts load when text first needs them, so `ready` alone
  // can resolve before they are requested, and a measurement taken with the fallback face is wrong.
  const fonts = document.fonts;
  if (fonts) {
    fonts.addEventListener("loadingdone", fit);
    void Promise.all(FONT_FACES.map((f) => fonts.load(f))).then(() => fonts.ready).then(fit, fit);
  }

  /** One frame: everything that changes, changes here, whole (a step, never a run). */
  function draw(m: RoomModel): void {
    gel.element.hidden = m.gel === null;
    if (m.gel) gel.update(m.gel);
    const parts: HTMLElement[] = [renderRail(m.rail)];
    if (m.clock) parts.push(renderClock(m.clock));
    if (m.metrics.length) parts.push(renderMetrics(m.metrics));
    if (m.cue) parts.push(renderCue(m.cue));
    if (m.next) parts.push(renderNext(m.next));
    if (m.intro) parts.push(renderIntro(m.intro));
    if (m.score) parts.push(renderScore(m.score));
    dyn.replaceChildren(...parts);
    fit();
  }

  /** Wakes at the next placed mark, when one waits for its frame. */
  function arm(): void {
    if (timer !== undefined) clock.cancel(timer);
    timer = undefined;
    const at = gate?.wakeAtMs() ?? null;
    if (gate === null || at === null) return;
    timer = clock.later(() => {
      timer = undefined;
      try {
        flush();
      } finally {
        arm();
      }
    }, Math.max(0, at - clock.now()));
  }

  let flushing: number | null = null;
  /**
   * Everything whose frame has come, in one frame: the screen's own mark and the outside changes. Each outside change is
   * drawn on its own, so one that throws does not take the others of the frame with it; the errors are reported (as uncaught) once
   * they have all been drawn.
   */
  function flush(): void {
    if (gate === null) return;
    const now = clock.now();
    const errors: unknown[] = [];
    const attempt = (run: () => void): void => {
      try {
        run();
      } catch (e) {
        errors.push(e);
      }
    };
    const m = gate.due(now);
    if (m) attempt(() => draw(m));
    const outer = flushing;
    flushing = now;
    for (const run of gate.dueOutside(now)) attempt(run);
    flushing = outer;
    // Reported where the page reports errors, once every change of the frame has been drawn and the timer is armed again.
    for (const e of errors) queueMicrotask(() => { throw e; });
  }

  return {
    update(input) {
      const m = toRoomModel(input, opts.scale?.() ?? LANDSCAPE_SCALE);
      if (gate === null) {
        draw(m);
        return;
      }
      const now = clock.now();
      const ctx: MarkContext = {
        changeAtMs: m.changeInMs === null ? null : now + m.changeInMs,
        switchAtMs: m.changeInMs === null || m.count === null ? null : now + (m.count.switchInMs ?? m.count.beatsLeft * m.count.beatMs),
      };
      try {
        const shown = gate.offer(m, now, ctx);
        if (shown) draw(shown);
        flush();
      } finally {
        arm();
      }
    },
    requestMark(run) {
      if (gate === null) {
        run();
        return { atMs: clock.now(), cancel: () => undefined };
      }
      // From inside a draw of this frame it is part of that draw.
      const ticket = gate.request(flushing ?? clock.now(), run);
      try {
        flush();
      } finally {
        arm();
      }
      return {
        get atMs() {
          return ticket.atMs;
        },
        cancel: () => {
          ticket.cancel();
          arm();
        },
      };
    },
    destroy() {
      if (timer !== undefined) clock.cancel(timer);
      resize?.disconnect();
      fonts?.removeEventListener("loadingdone", fit);
      root.remove();
    },
  };
}
