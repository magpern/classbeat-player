// The WebGL renderer: owns the canvas, the animation frame and the quality level's render scale, and
// each frame calls the rig loop and draws the rig. The shell gives it a `getFeed` (the class clock's
// state); the beams' directions are the model's drawn directions and nothing else (ADR 0009).
// The text layer is ordinary HTML over the canvas and is not here.

import { WebGLRenderer } from "three";
import type { QualityLevel } from "../../model/src/index.ts";
import { QUALITY } from "../../model/src/index.ts";
import { RigLoop } from "./loop.ts";
import type { Draw, Feed } from "./loop.ts";
import { SceneRig } from "./rig.ts";
import type { SceneTokens } from "./tokens.ts";

export interface RendererOptions {
  readonly tokens: SceneTokens;
  readonly quality?: QualityLevel;
  /** Called after each frame with what was drawn and the rig's measured beam directions. */
  readonly onFrame?: (draw: Draw, measured: ReturnType<SceneRig["measuredDirections"]>, nowMs: number) => void;
  /** Keeps the drawing buffer for screenshots; slightly slower. */
  readonly preserveDrawingBuffer?: boolean;
}

export class SceneRenderer {
  readonly rig: SceneRig;
  private readonly gl: WebGLRenderer;
  private readonly loop: RigLoop;
  private quality: QualityLevel;
  private last: number | null = null;
  private handle = 0;
  private running = false;

  readonly canvas: HTMLCanvasElement;
  private readonly options: RendererOptions;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions) {
    this.canvas = canvas;
    this.options = options;
    this.quality = options.quality ?? "High";
    this.gl = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: options.preserveDrawingBuffer ?? false });
    this.gl.setClearColor(0x000000, 1);
    this.rig = new SceneRig(options.tokens);
    this.loop = new RigLoop(options.tokens);
    this.resize();
  }

  /** The render scale is a share of the window (the text layer stays at full resolution). */
  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.gl.setPixelRatio(QUALITY[this.quality].renderScale * (window.devicePixelRatio || 1));
    this.gl.setSize(w, h, false);
    this.rig.setAspect(w / h);
  }

  setQuality(level: QualityLevel): void {
    this.quality = level;
    this.resize();
  }

  /** One frame at `nowMs` (a monotonic clock, as `requestAnimationFrame` gives). `draw3d` false steps the rig without the GL draw (a test driver). Returns what was drawn. */
  frame(feed: Feed, nowMs: number, draw3d = true): Draw {
    const raw = this.last === null ? 0 : (nowMs - this.last) / 1000;
    this.last = nowMs;
    const draw = this.loop.step(feed, raw, this.quality);
    this.rig.apply(draw, this.quality);
    if (draw3d) this.gl.render(this.rig.scene, this.rig.camera);
    this.options.onFrame?.(draw, this.rig.measuredDirections(), nowMs);
    return draw;
  }

  start(getFeed: () => Feed): void {
    if (this.running) return;
    this.running = true;
    const tick = (now: number) => {
      if (!this.running) return;
      this.frame(getFeed(), now);
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  dispose(): void {
    this.stop();
    this.rig.dispose();
    this.gl.dispose();
  }
}
