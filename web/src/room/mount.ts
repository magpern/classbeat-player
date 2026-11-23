// The room screen: mounts into an element and redraws from a snapshot. The only code that owns time,
// and only to place a redraw on a frame mark (mark-gate.ts): between marks nothing on the screen moves,
// there is no transition, no animation and no frame loop (docs/design/room-2d.md, "Motion and reduced
// motion"). Every other decision is in the pure modules.
import { el } from "./dom.ts";
import { toRoomModel } from "./adapter.ts";
import type { RoomInput } from "./input.ts";
import { createMarkGate } from "./mark-gate.ts";
import type { MarkContext } from "./mark-gate.ts";
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
      const m = gate.due(clock.now());
      if (m) draw(m);
      arm();
    }, Math.max(0, at - clock.now()));
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
        switchAtMs: m.changeInMs === null || m.count === null ? null : now + m.count.beatsLeft * m.count.beatMs,
      };
      const shown = gate.offer(m, now, ctx);
      if (shown) draw(shown);
      arm();
    },
    destroy() {
      if (timer !== undefined) clock.cancel(timer);
      resize?.disconnect();
      fonts?.removeEventListener("loadingdone", fit);
      root.remove();
    },
  };
}
