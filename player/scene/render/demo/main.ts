// The renderer on a page, for the screenshots and the browser frame log: the real SceneRenderer on a
// canvas, tokens read from the page's computed style (tokens.css), fed by the fake class of
// scenario.ts. Two modes. Manual (`?manual=1`): nothing runs on its own, the driver plays frames at a
// stated frame rate through `window.__scene.advance`, so a screenshot is the same every time. Auto
// (`?auto=1&t=10&speed=6`): requestAnimationFrame at the page's real frame times, the class clock
// running `speed` times faster than the wall clock. Other parameters: `state` (locked, paused,
// coasting, off, held), `rm=1` (reduced motion), `q` (High, Medium, Low).
import type { LinkInput, QualityLevel } from "../../model/src/index.ts";
import { SceneRenderer } from "../src/renderer.ts";
import { readSceneTokens } from "../src/tokens.ts";
import { FrameLog } from "../tools/frame-log.ts";
import { DEMO_CLASS, feedAt } from "./scenario.ts";

const params = new URLSearchParams(location.search);
const LINKS: Record<string, LinkInput> = { locked: { state: "Locked" }, paused: { state: "Paused" }, coasting: { state: "Coasting" }, off: { state: "Off the list" }, held: { state: "Locked", held: true } };
const state = {
  link: LINKS[params.get("state") ?? "locked"] ?? LINKS.locked!,
  reduced: params.get("rm") === "1",
  quality: (["High", "Medium", "Low"].includes(params.get("q") ?? "") ? params.get("q") : "High") as QualityLevel,
};
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const tokens = readSceneTokens(getComputedStyle(document.documentElement));
const log = new FrameLog(state.quality);
let song = 0;
let lastBurst = 0;
const renderer = new SceneRenderer(canvas, {
  tokens, quality: state.quality, preserveDrawingBuffer: true,
  onFrame: (draw, measured) => { lastBurst = draw.burst; log.add(draw, measured, song); },
});

let classMs = Number(params.get("t") ?? 0) * 1000;
const feed = () => feedAt(classMs, { link: state.link, reducedMotion: state.reduced });

interface DemoApi {
  /** Plays frames from `fromMs` to `toMs` at `fps` on a synthetic clock; the class clock steps by the frame time. */
  advance(fromMs: number, toMs: number, fps: number): void;
  set(next: { link?: string; reduced?: boolean; quality?: QualityLevel }): void;
  readonly log: FrameLog;
  readonly missingTokens: readonly string[];
  readonly ended: boolean;
  /** The white burst's share of its peak on the last frame. */
  readonly burst: number;
}
let nowMs = 0;
let ended = false;
const api: DemoApi = {
  advance(fromMs, toMs, fps) {
    classMs = fromMs;
    while (classMs < toMs) {
      nowMs += 1000 / fps;
      const f = feed();
      song = f.songIndex;
      // Software GL is slow: only the last frames are drawn, every frame is stepped.
      const d = renderer.frame(f, nowMs, toMs - classMs <= 1500 / fps);
      classMs += d.dtSeconds * 1000;
    }
  },
  set(next) {
    if (next.link) state.link = LINKS[next.link] ?? state.link;
    if (next.reduced !== undefined) state.reduced = next.reduced;
    if (next.quality) renderer.setQuality(next.quality);
  },
  log, missingTokens: tokens.missing,
  get ended() { return ended; },
  get burst() { return lastBurst; },
};
(window as unknown as { __scene: DemoApi }).__scene = api;

if (params.get("auto") === "1") {
  const speed = Number(params.get("speed") ?? 1);
  const stopAt = Number(params.get("to") ?? DEMO_CLASS.endMs / 1000) * 1000;
  let last: number | null = null;
  renderer.start(() => {
    const now = performance.now();
    if (last !== null) classMs += (now - last) * speed;
    last = now;
    if (classMs >= stopAt) { ended = true; classMs = stopAt; renderer.stop(); }
    const f = feed();
    song = f.songIndex;
    return f;
  });
} else {
  renderer.frame(feed(), 0); // the first frame: the beams start on their targets
}
window.addEventListener("resize", () => renderer.resize());
