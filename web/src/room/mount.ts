// The room screen: mounts into an element and redraws from a snapshot. The only code that owns
// time (the score's motion and the beat dot); every other decision is in the pure modules.
import { el } from "./dom.ts";
import { toRoomModel } from "./adapter.ts";
import type { RoomInput } from "./input.ts";
import type { BeatModel } from "./model.ts";
import { createGel } from "./render-gel.ts";
import { fitTitle, renderIntro } from "./render-intro.ts";
import { renderClock, renderCue, renderMetrics, renderNext, renderRail } from "./render-parts.ts";
import { renderScore } from "./render-score.ts";
import type { ScoreView } from "./render-score.ts";
import { scoreShiftVw } from "./score.ts";

export interface RoomOptions {
  /** Defaults to the system's `prefers-reduced-motion`; the player's own setting passes true. */
  readonly reducedMotion?: boolean;
  /** False freezes the score and the beat dot (screenshots and checks). */
  readonly animate?: boolean;
}

export interface RoomScreen {
  update(input: RoomInput): void;
  destroy(): void;
}

/** The beat dot: it flashes 120 ms on the beat and is not made at all with reduced motion. */
function beatDot(beat: BeatModel | null, reduced: boolean, animate: boolean): HTMLElement | null {
  if (!beat || reduced) return null;
  const dot = el("span", { class: "beat" });
  if (animate && typeof dot.animate === "function") {
    const flashShare = Math.min(0.5, 120 / beat.periodMs);
    const a = dot.animate(
      [
        { opacity: 1, offset: 0 },
        { opacity: 0.2, offset: flashShare },
        { opacity: 0.2, offset: 1 },
      ],
      { duration: beat.periodMs, iterations: Infinity },
    );
    // The next flash falls `phaseMs` from now.
    a.currentTime = (beat.periodMs - (beat.phaseMs % beat.periodMs)) % beat.periodMs;
  }
  return dot;
}

export function mountRoom(host: HTMLElement, opts: RoomOptions = {}): RoomScreen {
  const reduced = opts.reducedMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const animate = opts.animate ?? true;
  if (reduced) document.documentElement.dataset.reducedMotion = "";
  const root = el("div", { class: "room" });
  const gel = createGel();
  const dyn = el("div", { class: "dyn" });
  root.append(gel.element, dyn);
  host.append(root);

  let lastKey: string | null = null;
  let score: ScoreView | null = null;
  let moving = false;
  let startedAt = 0;
  let raf = 0;

  const tick = (): void => {
    if (score && moving) score.shift(scoreShiftVw(performance.now() - startedAt, reduced));
    raf = requestAnimationFrame(tick);
  };
  if (animate) raf = requestAnimationFrame(tick);

  const fit = (): void => {
    const h1 = dyn.querySelector<HTMLElement>(".intro h1");
    if (h1) fitTitle(h1);
  };
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
  resize?.observe(root);
  void document.fonts?.ready.then(fit);

  return {
    update(input) {
      const m = toRoomModel(input);
      // The first draw is not an interval change: no start-up animation (recovery from the 3D scene).
      const changed = lastKey !== null && lastKey !== m.intervalKey;
      lastKey = m.intervalKey;
      gel.element.hidden = m.gel === null;
      if (m.gel) gel.update(m.gel, changed);
      const parts: HTMLElement[] = [renderRail(m.rail)];
      if (m.clock) parts.push(renderClock(m.clock));
      if (m.metrics.length) parts.push(renderMetrics(m.metrics, beatDot(m.beat, reduced, animate)));
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
      root.remove();
    },
  };
}
