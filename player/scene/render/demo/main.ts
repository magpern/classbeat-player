// The renderer on a page, for the screenshots and the browser frame log: the real SceneRenderer on a
// canvas, tokens read from the page's computed style (tokens.css), fed by the fake class of
// scenario.ts. Two modes. Manual (`?manual=1`): nothing runs on its own, the driver plays frames at a
// stated frame rate through `window.__scene.advance`, so a screenshot is the same every time. Auto
// (`?auto=1&t=10&speed=6`): requestAnimationFrame at the page's real frame times, the class clock
// running `speed` times faster than the wall clock. Other parameters: `state` (locked, paused,
// coasting, off, held), `rm=1` (reduced motion), `q` (High, Medium, Low), `class=long` (sixteen
// minutes with the lengths of a real class, for the text), `stage=before` (the house look before the start), `class=worst` (its worst case of fitting), `mask=0` (the scene without the
// dark-under-text mask, to show what the mask darkens), `floor=off` (the house look without S5b's floor: the check must fail on it), `budget=off` (every run fits: to look at a burst the scheduler skips), `text=0` (the scene without the text layer).
import { WebGLRenderer } from "three";
import type { LinkInput, QualityLevel, RigHue, SceneClass } from "../../model/src/index.ts";
import { angleBetween, mergeIntervals } from "../../model/src/index.ts";
import type { Host } from "../src/host.ts";
import { plannedMarkIn } from "../src/frame-marks-calc.ts";
import { SceneRenderer } from "../src/renderer.ts";
import { TAN_H } from "../src/rig.ts";
import { readSceneTokens } from "../src/tokens.ts";
import type { Feed } from "../src/loop.ts";
import type { TextBox } from "../src/text-box.ts";
import type { Shown } from "../src/text-clock.ts";
import { mergeTextClass } from "../src/text-merge-calc.ts";
import { textView } from "../src/text-view-calc.ts";
import type { TextView } from "../src/text-view.ts";
import { TextLayer } from "../layer/text-layer.ts";
import { FrameLog } from "../tools/frame-log.ts";
import { DEMO_TEXT } from "./demo-text.ts";
import { RUNNING_TEXT } from "./running-class.ts";
import { LONG_END_MS, LONG_TEXT, WORST_TEXT, longFeedAt } from "./long-class.ts";
import { DEMO_CLASS, VARIANTS, feedAt } from "./scenario.ts";

const params = new URLSearchParams(location.search);
const LINKS: Record<string, LinkInput> = { locked: { state: "Locked" }, paused: { state: "Paused" }, coasting: { state: "Coasting" }, off: { state: "Off the list" }, held: { state: "Locked", held: true } };
const state = {
  link: LINKS[params.get("state") ?? "locked"] ?? LINKS.locked!,
  reduced: params.get("rm") === "1",
  stage: (["before"].includes(params.get("stage") ?? "") ? params.get("stage") : undefined) as Feed["stage"],
  quality: (["High", "Medium", "Low"].includes(params.get("q") ?? "") ? params.get("q") : "High") as QualityLevel,
};
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const tokens = readSceneTokens(getComputedStyle(document.documentElement));
const log = new FrameLog(state.quality);
let song = 0;
let lastBurst = 0;
let lastSweeping = false;
let wasDark = false;
let lastMark = "";
let pendingMark = false;
let lastFrameMs: number | null = null;
/** The class with interval changes under 1 s apart merged (P1), as the loop has it: once per class. */
const mergedClasses = new WeakMap<SceneClass, SceneClass>();
const mergedClass = (cls: SceneClass): SceneClass => {
  let made = mergedClasses.get(cls);
  if (made === undefined) { made = mergeIntervals(cls); mergedClasses.set(cls, made); }
  return made;
};
let lastMaster = 1;
let lastTokens: { current: number; next: number | null } = { current: 0, next: null };
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
// Interval changes under 1 s apart are one change frame in the text too (P1): the merged-away interval is absent from it.
const textClass = mergeTextClass(params.get("class") === "worst" ? WORST_TEXT : long ? LONG_TEXT : params.get("class") === "running" ? RUNNING_TEXT : DEMO_TEXT);
const layer = new TextLayer();
const renderer = new SceneRenderer(host, {
  tokens, quality: state.quality, textMask: params.get("mask") !== "0", budgetOff: params.get("budget") === "off", steadyOnly: params.get("steady") === "1", adapt: params.get("adapt") === "1",
  onFrame: (draw, measured) => {
    lastBurst = draw.burst;
    // A sweep: a beam off its target, and the frames of its dark span with the step in and the step out ("A sweep moves in black"), the sweep's own one change
    // each, counted by S6 as drawn (the S6 gate reads every frame) and left out of the steady-light windows as the turning beams are.
    lastSweeping = draw.dark || wasDark || draw.frame.directions.some((t, i) => { const d = draw.drawn[i]; return d !== undefined && angleBetween(d, t) > 0.01; });
    wasDark = draw.dark;
    // A frame the scheduler marks: an event of the person (a link state, a quality step, a seek) or a mark `planMarks` places (a change frame, a
    // drop's frame, a text step). The cause is named in the gate's report. Nothing is marked because the draw changed.
    const planned = lastFrameMs !== null && plannedMarkIn({ cls: mergedClass(lastFeed.cls), classMs, songIndex: lastFeed.songIndex, songPosMs: lastFeed.songPosMs, level: draw.frame.level }, lastFrameMs, classMs);
    lastMark = pendingMark ? "event" : planned ? "planned mark" : draw.heldMark !== null ? "held change, own mark (P2)" : "";
    pendingMark = false;
    lastFrameMs = classMs;
    lastMaster = draw.master;
    const hex = (h: RigHue) => (h.kind === "zone" ? tokens.zones[h.zone] : tokens.white);
    lastTokens = { current: hex(draw.tokens.current), next: draw.tokens.next === null ? null : hex(draw.tokens.next) };
    log.add(draw, measured, song);
  },
});
renderer.rig.floorOn = params.get("floor") !== "off";

let classMs = Number(params.get("t") ?? 0) * 1000;
/** The demo's `level=tempo`: every song keeps its bpm and loses its anchors, so the link is locked at the Tempo only level. Never the product. */
const tempoClasses = new WeakMap<SceneClass, SceneClass>();
const tempoOnly = (f: Feed): Feed => {
  if (params.get("level") !== "tempo") return f;
  let cls = tempoClasses.get(f.cls);
  if (cls === undefined) { cls = { ...f.cls, songs: f.cls.songs.map((song) => ({ ...song, anchors: [] })) }; tempoClasses.set(f.cls, cls); }
  return { ...f, cls };
};
const feed = (): Feed => tempoOnly(long ? { ...longFeedAt(classMs, state.link, state.reduced), ...(state.stage ? { stage: state.stage } : {}) } : feedAt(classMs, { link: state.link, reducedMotion: state.reduced, stage: state.stage, variant: VARIANTS[params.get("class") ?? "demo"] ?? VARIANTS.demo! }));
let view: TextView | null = null;
let lastFeed: Feed = feed();
let lastBoxes: readonly TextBox[] = [];

let lastShown: Shown | null = null;
/** The text has stepped (a frame mark) since it was last painted: a frame that was not drawn leaves it to the next one that is. */
let textDirty = true;
let textVersion = 0;

/** The text layer for this frame: the class as the scheduler's last frame mark has it (the renderer's `textAt`), the DOM, and the lines' boxes handed to the scene's mask (S2). */
function stepText(f: Feed): void {
  lastFeed = f;
  const shown = renderer.textAt(f);
  if (shown.changed) textDirty = true;
  lastShown = shown;
}
function paintText(force = false): boolean {
  if (params.get("text") === "0" || lastShown === null || !(textDirty || force || view === null)) return false;
  const s = lastShown;
  view = textView({ cls: textClass, classMs: s.classMs, songIndex: s.songIndex, songPosMs: s.songPosMs, link: s.link, reducedMotion: s.reducedMotion, aspect: window.innerWidth / Math.max(1, window.innerHeight) });
  textDirty = false;
  textVersion++;
  layer.update(view);
  const boxes = layer.boxes();
  if (boxes !== lastBoxes) { lastBoxes = boxes; renderer.setTextBoxes(boxes); }
  return true;
}

/** Which frames of a run are drawn, and what to do after one (the light measurement). */
interface Sampler {
  draws(classMs: number): boolean;
  after(classMs: number): void;
  /** What the person does during the run, each once, when the class clock first reaches `atMs`: a link state ("base" is the run's own), a quality level, a seek. */
  events?: readonly { readonly atMs: number; readonly link?: string; readonly quality?: QualityLevel; readonly jumpMs?: number }[];
}

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
  /** The scheduler's mark on the last frame ("planned mark" or "event": a quality step, a seek, a jump), or "": a marked frame's one-frame jump in light is not steady light. */
  readonly mark: string;
  /** Whether any beam's drawn direction is off its target on the last frame (a sweep, scene.md "Steady light and sweeps"). */
  readonly sweeping: boolean;
  /** The rig's master level on the last frame: 1 running, a quarter at the bottom of a song-change dim. */
  readonly master: number;
  /** The two tokens in play on the last frame, as 0xRRGGBB: the planned zone's, and the next zone's during the anticipation. */
  readonly tokens: { readonly current: number; readonly next: number | null };
  /** How many times the text layer has been painted: the frames on which the text stepped. */
  readonly textVersion: number;
  /** Starts a run for `resume`: from `fromMs` to `toMs` at `fps`, with the sampler's events. */
  begin(fromMs: number, toMs: number, fps: number, sampler?: Sampler): void;
  /** Plays the run's frames until the text steps in a drawn frame (it returns that frame's time: the page now holds the new text, and the sampler's `after` for that frame is the caller's to run) or the run ends. */
  resume(): { readonly pending: number | null; readonly done: boolean };
  /** The lit beams as the shader has them (origin, direction, spread), the canvas's drawing-buffer size and the camera's half field of view as a tangent: what the S5b check walks. */
  rigState(): { beams: { o: number[]; d: number[]; spread: number }[]; width: number; height: number; tanH: number };
}
declare global {
  interface Window { __scene: DemoApi }
}
/** A run being played frame by frame, for a driver that must look at the page when the text steps (the whole-frame S6 gate). */
interface Run {
  readonly toMs: number;
  readonly fps: number;
  readonly sampler: Sampler | undefined;
  readonly due: { readonly atMs: number; readonly link?: string; readonly quality?: QualityLevel; readonly jumpMs?: number }[];
}
let nowMs = 0;
let ended = false;
let run: Run | null = null;

/** One frame of a run: the events due, the text clock, the text when it stepped, the rig. Returns the frame's time when the text stepped in it and `stopOnText` asked to look. */
function playFrame(r: Run, stopOnText: boolean): number | null {
  for (const e of r.due.filter((x) => x.atMs <= classMs)) {
    r.due.splice(r.due.indexOf(e), 1);
    pendingMark = true;
    if (e.link) state.link = LINKS[e.link === "base" ? (params.get("state") ?? "locked") : e.link] ?? state.link;
    if (e.quality) renderer.setQuality(e.quality);
    if (e.jumpMs !== undefined) classMs = e.jumpMs;
  }
  nowMs += 1000 / r.fps;
  const f = feed();
  song = f.songIndex;
  stepText(f);
  // Software GL is slow: only the last frames (or the sampler's) are drawn, every frame is stepped.
  const drawn = r.sampler ? r.sampler.draws(classMs) : r.toMs - classMs <= 1500 / r.fps;
  const painted = drawn && paintText();
  const d = renderer.frame(f, nowMs, drawn);
  let looked: number | null = null;
  if (drawn) {
    if (stopOnText && painted) looked = classMs;
    else r.sampler?.after(classMs);
  }
  classMs += d.dtSeconds * 1000;
  return looked;
}

const api: DemoApi = {
  advance(fromMs, toMs, fps, sampler) {
    classMs = fromMs;
    const r: Run = { toMs, fps, sampler, due: [...(sampler?.events ?? [])] };
    while (classMs < toMs) playFrame(r, false);
  },
  begin(fromMs, toMs, fps, sampler) {
    classMs = fromMs;
    run = { toMs, fps, sampler, due: [...(sampler?.events ?? [])] };
  },
  resume() {
    if (run === null) throw new Error("no run begun");
    while (classMs < run.toMs) {
      const looked = playFrame(run, true);
      if (looked !== null) return { pending: looked, done: false };
    }
    return { pending: null, done: true };
  },
  get textVersion() { return textVersion; },
  settle() {
    layer.invalidate();
    stepText(lastFeed);
    paintText(true);
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
  get sweeping() { return lastSweeping; },
  get mark() { return lastMark; },
  get master() { return lastMaster; },
  get tokens() { return lastTokens; },
  rigState() {
    const dirs = renderer.rig.uniform("uBD") as { x: number; y: number; z: number }[];
    const levels = renderer.rig.beamLevels();
    const beams = renderer.rig.fixtures.flatMap((f, i) => ((levels[i] ?? 0) > 0 ? [{ o: f.pivot.position.toArray(), d: [dirs[i]!.x, dirs[i]!.y, dirs[i]!.z], spread: f.spread }] : []));
    return { beams, width: canvas.width, height: canvas.height, tanH: TAN_H };
  },
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
    stepText(f);
    paintText();
    return f;
  });
} else {
  const first = feed();
  stepText(first);
  paintText();
  renderer.frame(first, 0); // the first frame: the beams start on their targets
}
