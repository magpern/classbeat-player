// The room screen: mounts into an element and redraws from a snapshot. The only code that owns
// time (the score's motion and the beat dot); every other decision is in the pure modules.
import { el } from "./dom.ts";
import { toRoomModel } from "./adapter.ts";
import { lastLightStart, nextSchedule } from "./beat-schedule.ts";
import type { BeatSchedule } from "./beat-schedule.ts";
import type { RoomInput } from "./input.ts";
import type { BeatModel } from "./model.ts";
import { createGel } from "./render-gel.ts";
import { fitTitle, renderIntro } from "./render-intro.ts";
import { renderClock, renderCue, renderMetrics, renderNext, renderRail } from "./render-parts.ts";
import { renderScore } from "./render-score.ts";
import type { ScoreView } from "./render-score.ts";
import { scoreShiftVw, VW_PER_S } from "./score.ts";
import { LANDSCAPE_SCALE, layoutOf } from "./score-scale.ts";
import type { ScoreScale } from "./score-scale.ts";

/** The faces the screen measures with (system.md, Type); loaded explicitly so the first fit is not made with a fallback. */
const FONT_FACES = ['600 1em "Big Shoulders Display"', '800 1em "Big Shoulders Display"', '400 1em "Atkinson Hyperlegible"', '700 1em "Atkinson Hyperlegible"'];

export interface RoomOptions {
  /** Defaults to the system's `prefers-reduced-motion`; the player's own setting passes true. */
  readonly reducedMotion?: boolean;
  /** False freezes the score and the beat dot (screenshots and checks). */
  readonly animate?: boolean;
  /** The score's scale for the layout now on screen (the web player page changes it with the viewport); the room's own when absent. */
  readonly scale?: () => ScoreScale;
}

export interface RoomScreen {
  update(input: RoomInput): void;
  destroy(): void;
}

/**
 * The beat dot after the BPM. The element is redrawn with every snapshot, but when it lights is
 * kept in a schedule (beat-schedule.ts), so jitter between snapshots never adds a light and a new
 * tempo never lights within 1/3 s of the last one. Not made at all with reduced motion.
 */
function createBeatDots(reduced: boolean, animate: boolean): (beat: BeatModel | null) => HTMLElement | null {
  let schedule: BeatSchedule | null = null;
  let lastStart: number | null = null;
  return (beat) => {
    const now = performance.now();
    if (schedule) lastStart = lastLightStart(schedule, now) ?? lastStart;
    if (!beat || reduced) {
      schedule = null;
      return null;
    }
    schedule = nextSchedule(schedule, lastStart, beat, now);
    const dot = el("span", { class: "beat" });
    if (animate && typeof dot.animate === "function") {
      // Lit for the first 30 % of each period. The start time is absolute on the document's
      // timeline, so redrawing the dot (a new element every snapshot) cannot move a light.
      const a = dot.animate(
        [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0.2, offset: 0.3 }, { opacity: 0.2, offset: 1 }],
        { duration: schedule.periodMs, iterations: Infinity },
      );
      a.startTime = schedule.anchorMs;
    }
    return dot;
  };
}

/**
 * A cue that needs a fourth line at 3:2 and narrower takes the next row's place for that interval
 * (room-2d.md); the product measures it: the cue box clips at three lines until `.four` is set.
 */
function fitCue(cue: HTMLElement | null, allowed: boolean): void {
  if (!cue) return;
  cue.classList.remove("four");
  // The web player page's phone layouts give the cue the height it needs themselves.
  if (!allowed) return;
  const narrow = typeof matchMedia === "function" && matchMedia("(max-aspect-ratio: 3/2)").matches;
  const lineHeight = parseFloat(getComputedStyle(cue).lineHeight);
  if (narrow && cue.scrollHeight > lineHeight * 3.5) cue.classList.add("four");
}

export function mountRoom(host: HTMLElement, opts: RoomOptions = {}): RoomScreen {
  const reduced = opts.reducedMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const animate = opts.animate ?? true;
  if (reduced) document.documentElement.dataset.reducedMotion = "";
  const root = el("div", { class: "room" });
  const gel = createGel();
  const dyn = el("div", { class: "dyn" });
  const beatDot = createBeatDots(reduced, animate);
  root.append(gel.element, dyn);
  host.append(root);

  let lastKey: string | null = null;
  let score: ScoreView | null = null;
  let moving = false;
  let vwPerS = VW_PER_S;
  let startedAt = 0;
  let raf = 0;

  const tick = (): void => {
    if (score && moving) score.shift(scoreShiftVw(performance.now() - startedAt, reduced, vwPerS));
    raf = requestAnimationFrame(tick);
  };
  if (animate) raf = requestAnimationFrame(tick);

  const fit = (): void => {
    const h1 = dyn.querySelector<HTMLElement>(".intro h1");
    if (h1) fitTitle(h1);
    fitCue(dyn.querySelector<HTMLElement>(".cue"), opts.scale === undefined || layoutOf(window.innerWidth, window.innerHeight) === "room");
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

  return {
    update(input) {
      const sc = opts.scale?.() ?? LANDSCAPE_SCALE;
      vwPerS = sc.vwPerS;
      const m = toRoomModel(input, sc);
      // The first draw is not an interval change: no start-up animation (recovery from the 3D scene).
      const changed = lastKey !== null && lastKey !== m.intervalKey;
      lastKey = m.intervalKey;
      gel.element.hidden = m.gel === null;
      if (m.gel) gel.update(m.gel, changed);
      const parts: HTMLElement[] = [renderRail(m.rail)];
      if (m.clock) parts.push(renderClock(m.clock));
      const dot = beatDot(m.beat);
      if (m.metrics.length) parts.push(renderMetrics(m.metrics, dot));
      if (m.cue) parts.push(renderCue(m.cue));
      if (m.next) parts.push(renderNext(m.next));
      if (m.intro) parts.push(renderIntro(m.intro));
      score = m.score ? renderScore(m.score) : null;
      if (score) parts.push(score.element);
      moving = m.moving;
      startedAt = performance.now();
      dyn.replaceChildren(...parts);
      fit();
    },
    destroy() {
      cancelAnimationFrame(raf);
      resize?.disconnect();
      fonts?.removeEventListener("loadingdone", fit);
      root.remove();
    },
  };
}
