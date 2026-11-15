// The renderer on a page, for the screenshots and the browser frame log: the real SceneRenderer on a
// canvas, tokens read from the page's computed style (tokens.css), fed by the fake class of
// scenario.ts. Two modes. Manual (`?manual=1`): nothing runs on its own, the driver plays frames at a
// stated frame rate through `window.__scene.advance`, so a screenshot is the same every time. Auto
// (`?auto=1&t=10&speed=6`): requestAnimationFrame at the page's real frame times, the class clock
// running `speed` times faster than the wall clock. Other parameters: `state` (locked, paused,
// coasting, off, held), `rm=1` (reduced motion), `q` (High, Medium, Low), `class=long` (sixteen
// minutes with the lengths of a real class, for the text), `class=worst` (its worst case of fitting), `mask=0` (the scene without the
// dark-under-text mask, to show what the mask darkens), `text=0` (the scene without the text layer).
import { WebGLRenderer } from "three";
import type { LinkInput, QualityLevel } from "../../model/src/index.ts";
import type { Host } from "../src/host.ts";
import { SceneRenderer } from "../src/renderer.ts";
import { readSceneTokens } from "../src/tokens.ts";
import type { Feed } from "../src/loop.ts";
import type { TextBox } from "../src/text-box.ts";
import { textView } from "../src/text-view-calc.ts";
import type { TextView } from "../src/text-view.ts";
import { TextLayer } from "../layer/text-layer.ts";
import { FrameLog } from "../tools/frame-log.ts";
import { DEMO_TEXT } from "./demo-text.ts";
import { LONG_END_MS, LONG_TEXT, WORST_TEXT, longFeedAt } from "./long-class.ts";
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
// The host: it builds the three.js renderer from its own canvas and hands the scene only this.
const gl = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
gl.setClearColor(0x000000, 1);
const host: Host = {
  painter: { setPixelRatio: (r) => gl.setPixelRatio(r), setSize: (w, h) => gl.setSize(w, h, false), render: (scene, camera) => gl.render(scene, camera), dispose: () => gl.dispose() },
  size: () => ({ width: canvas.clientWidth || window.innerWidth, height: canvas.clientHeight || window.innerHeight, pixelRatio: window.devicePixelRatio || 1 }),
  onResize: (listener) => { window.addEventListener("resize", listener); return () => window.removeEventListener("resize", listener); },
  schedule: (callback) => { const id = window.requestAnimationFrame(callback); return () => window.cancelAnimationFrame(id); },
};
const long = params.get("class") === "long" || params.get("class") === "worst";
const textClass = params.get("class") === "worst" ? WORST_TEXT : long ? LONG_TEXT : DEMO_TEXT;
const layer = new TextLayer("text");
const renderer = new SceneRenderer(host, {
  tokens, quality: state.quality, textMask: params.get("mask") !== "0",
  onFrame: (draw, measured) => { lastBurst = draw.burst; log.add(draw, measured, song); },
});

let classMs = Number(params.get("t") ?? 0) * 1000;
const feed = (): Feed => (long ? longFeedAt(classMs, state.link, state.reduced) : feedAt(classMs, { link: state.link, reducedMotion: state.reduced }));
let view: TextView | null = null;
let lastFeed: Feed = feed();
let lastBoxes: readonly TextBox[] = [];

/** The text layer for this frame: the view, the DOM, and the lines' boxes handed to the scene's mask (S2). */
function paintText(f: Feed): void {
  lastFeed = f;
  if (params.get("text") === "0") return;
  view = textView({ cls: textClass, classMs: f.classMs, songIndex: f.songIndex, songPosMs: f.songPosMs, link: f.link, reducedMotion: f.reducedMotion, aspect: window.innerWidth / Math.max(1, window.innerHeight) });
  layer.update(view);
  const boxes = layer.boxes();
  if (boxes !== lastBoxes) { lastBoxes = boxes; renderer.setTextBoxes(boxes); }
}

/** Which frames of a run are drawn, and what to do after one (the light measurement). */
interface Sampler { draws(classMs: number): boolean; after(classMs: number): void }

interface DemoApi {
  /** Plays frames from `fromMs` to `toMs` at `fps` on a synthetic clock; the class clock steps by the frame time. */
  advance(fromMs: number, toMs: number, fps: number, sampler?: Sampler): void;
  set(next: { link?: string; reduced?: boolean; quality?: QualityLevel }): void;
  /** Lays the text out again and redraws the last frame (once the fonts have loaded). */
  settle(): void;
  readonly text: { boxes(): TextBox[]; readonly view: TextView | null; readonly endMs: number };
  readonly log: FrameLog;
  readonly missingTokens: readonly string[];
  readonly ended: boolean;
  /** The white burst's share of its peak on the last frame. */
  readonly burst: number;
}
declare global {
  interface Window { __scene: DemoApi }
}
let nowMs = 0;
let ended = false;
const api: DemoApi = {
  advance(fromMs, toMs, fps, sampler) {
    classMs = fromMs;
    while (classMs < toMs) {
      nowMs += 1000 / fps;
      const f = feed();
      song = f.songIndex;
      // Software GL is slow: only the last frames (or the sampler's) are drawn, every frame is stepped.
      const drawn = sampler ? sampler.draws(classMs) : toMs - classMs <= 1500 / fps;
      if (drawn) paintText(f);
      const d = renderer.frame(f, nowMs, drawn);
      if (drawn) sampler?.after(classMs);
      classMs += d.dtSeconds * 1000;
    }
  },
  settle() {
    layer.invalidate();
    paintText(lastFeed);
    renderer.frame(lastFeed, nowMs, true);
  },
  text: { boxes: () => layer.boxes(), get view() { return view; }, endMs: long ? LONG_END_MS : DEMO_CLASS.endMs },
  set(next) {
    if (next.link) state.link = LINKS[next.link] ?? state.link;
    if (next.reduced !== undefined) state.reduced = next.reduced;
    if (next.quality) renderer.setQuality(next.quality);
  },
  log, missingTokens: tokens.missing,
  get ended() { return ended; },
  get burst() { return lastBurst; },
};
window.__scene = api;

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
    paintText(f);
    return f;
  });
} else {
  paintText(feed());
  renderer.frame(feed(), 0); // the first frame: the beams start on their targets
}
