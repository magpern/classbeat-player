// The scene renderer: owns the rig loop, the quality level's render scale and the frame schedule,
// and each frame calls the loop and has the host's painter draw the rig. The host (the demo page
// now, the shell's room window later) hands it a `Host` and a `getFeed` (the class clock's state);
// it never sees the canvas, `window` or `document`. The beams' directions are the model's drawn
// directions and nothing else (ADR 0009). The text layer is ordinary HTML over the canvas and is
// not here.

import type { QualityLevel } from "../../model/src/index.ts";
import { QUALITY } from "../../model/src/index.ts";
import type { Host } from "./host.ts";
import { RigLoop } from "./loop.ts";
import type { Draw, Feed } from "./loop.ts";
import { SceneRig } from "./rig.ts";
import { steadyOnly } from "./steady-calc.ts";
import type { Shown } from "./text-clock.ts";
import type { SceneTokens } from "./tokens.ts";
import { lookup } from "./lookup.ts";
import type { TextBox } from "./text-box.ts";

export interface RendererOptions {
  readonly tokens: SceneTokens;
  readonly quality?: QualityLevel;
  /** False only in the test that shows the light without the dark-under-text mask. */
  readonly textMask?: boolean;
  /** The demo's `budget=off`: every run fits, so a burst the scheduler would skip can be looked at. Never the product. */
  readonly budgetOff?: boolean;
  /** The demo's `steady=1`: only steady light is drawn (steady-calc.ts), for the gate's per-region rate. Never the product. */
  readonly steadyOnly?: boolean;
  /** Called after each frame with what was drawn and the rig's measured beam directions. */
  readonly onFrame?: (draw: Draw, measured: ReturnType<SceneRig["measuredDirections"]>, nowMs: number) => void;
}

export class SceneRenderer {
  readonly rig: SceneRig;
  private readonly host: Host;
  private readonly loop: RigLoop;
  private readonly options: RendererOptions;
  private readonly unsubscribe: () => void;
  private quality: QualityLevel;
  private boxes: readonly TextBox[] = [];
  private last: number | null = null;
  private cancel: (() => void) | null = null;
  private running = false;

  constructor(host: Host, options: RendererOptions) {
    this.host = host;
    this.options = options;
    this.quality = options.quality ?? "High";
    this.rig = new SceneRig(options.tokens);
    this.loop = new RigLoop(options.tokens, options.budgetOff === true);
    this.unsubscribe = host.onResize(() => this.resize());
    this.rig.mask.setEnabled(options.textMask !== false);
    this.resize();
  }

  /** The text lines' boxes now (CSS pixels): the light under them is held to the cap (S2). */
  setTextBoxes(boxes: readonly TextBox[]): void {
    this.boxes = boxes;
    const { width, height } = this.host.size();
    this.rig.mask.set(boxes, width, height);
  }

  /** What the text layer shows on this frame: the class as it was on the last frame mark (text rule 2). Ask before `frame` to paint the text first; `frame` gives the same answer. */
  textAt(feed: Feed): Shown {
    return this.loop.shown(feed);
  }

  /** The render scale is a share of the window (the text layer stays at full resolution). */
  resize(): void {
    const { width, height, pixelRatio } = this.host.size();
    const [w, h] = [Math.max(1, width), Math.max(1, height)];
    this.host.painter.setPixelRatio(lookup(QUALITY, this.quality).renderScale * (pixelRatio || 1));
    this.host.painter.setSize(w, h);
    this.rig.setAspect(w / h);
    this.rig.mask.set(this.boxes, w, h);
  }

  setQuality(level: QualityLevel): void {
    this.quality = level;
    this.resize();
  }

  /** One frame at `nowMs` (a monotonic clock, as the frame scheduler gives). `draw3d` false steps the rig without the draw (a test driver). Returns what was drawn. */
  frame(feed: Feed, nowMs: number, draw3d = true): Draw {
    const raw = this.last === null ? 0 : (nowMs - this.last) / 1000;
    this.last = nowMs;
    const stepped = this.loop.step(feed, raw, this.quality);
    const draw = this.options.steadyOnly === true ? steadyOnly(stepped) : stepped;
    this.rig.apply(draw, this.quality);
    if (draw3d) this.host.painter.render(this.rig.scene, this.rig.camera);
    this.options.onFrame?.(draw, this.rig.measuredDirections(), nowMs);
    return draw;
  }

  start(getFeed: () => Feed): void {
    if (this.running) return;
    this.running = true;
    const tick = (now: number) => {
      if (!this.running) return;
      this.frame(getFeed(), now);
      this.cancel = this.host.schedule(tick);
    };
    this.cancel = this.host.schedule(tick);
  }

  stop(): void {
    this.running = false;
    this.cancel?.();
    this.cancel = null;
  }

  dispose(): void {
    this.stop();
    this.unsubscribe();
    this.rig.dispose();
    this.host.painter.dispose();
  }
}
