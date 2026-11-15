// The frame log (scene.md S7 and S9): once a second, the highest beam speed, the frame rate and the
// quality level, from a run that plays through a phrase flip, a song change from a mirrored phrase
// and a build with its drop. A beam's speed is measured on what the rig really holds (the angle
// between its direction on two consecutive frames over the frame time used), not on the model's
// number. The same `FrameLog` collects it in Node (`measure`) and in the browser run (tools/shots.ts).
import type { Direction, QualityLevel } from "../../model/src/index.ts";
import { MAX_DEG_PER_SECOND, angleBetween } from "../../model/src/index.ts";
import type { Draw } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { SceneRig } from "../src/rig.ts";
import type { SceneTokens } from "../src/tokens.ts";
import { feedAt } from "../demo/scenario.ts";

export interface LogRow {
  readonly second: number;
  /** The highest beam speed on any frame of this second, degrees a second. */
  readonly peakDegPerSecond: number;
  readonly frames: number;
  readonly fps: number;
  readonly quality: QualityLevel;
}
/** The transitions the run went through: without them the check measures nothing. */
export interface Seen {
  phraseFlips: number;
  songChangesFromMirrored: number;
  gathers: number;
  drops: number;
  bursts: number;
}

/** The run fails above this: 30 degrees a second with 2 percent for timing (scene.md). */
export const LIMIT_DEG_PER_SECOND = MAX_DEG_PER_SECOND * 1.02;

export class FrameLog {
  readonly rows: LogRow[] = [];
  readonly seen: Seen = { phraseFlips: 0, songChangesFromMirrored: 0, gathers: 0, drops: 0, bursts: 0 };
  private readonly quality: QualityLevel;
  private prevDirs: readonly Direction[] | null = null;
  private prev: { readonly draw: Draw; readonly song: number } | null = null;
  private elapsed = 0;
  private peak = 0;
  private frames = 0;

  constructor(quality: QualityLevel) {
    this.quality = quality;
  }

  /** Record one frame: `measured` is read back from the rig, `draw` is what the loop gave it. */
  add(draw: Draw, measured: readonly Direction[], songIndex: number): void {
    if (this.prevDirs) {
      const dt = draw.dtSeconds > 0 ? draw.dtSeconds : 1 / 60;
      this.peak = Math.max(this.peak, ...measured.map((d, i) => angleBetween(this.prevDirs![i]!, d) / dt));
    }
    this.count(draw, songIndex);
    this.prevDirs = measured;
    this.prev = { draw, song: songIndex };
    this.frames++;
    this.elapsed += draw.dtSeconds;
    if (this.elapsed >= 1) this.flush();
  }

  private count(draw: Draw, songIndex: number): void {
    const p = this.prev;
    if (draw.burst > 0 && (p?.draw.burst ?? 0) === 0) this.seen.bursts++;
    if (!p) return;
    if (songIndex !== p.song) {
      if (p.draw.frame.phrase.mirrored) this.seen.songChangesFromMirrored++;
    } else if (draw.frame.phrase.mirrored !== p.draw.frame.phrase.mirrored) this.seen.phraseFlips++;
    if (draw.frame.moments.gather && !p.draw.frame.moments.gather) this.seen.gathers++;
    if (draw.frame.moments.fan && !p.draw.frame.moments.fan) this.seen.drops++;
  }

  private flush(): void {
    const fps = Math.round((this.frames / this.elapsed) * 10) / 10;
    this.rows.push({ second: this.rows.length, peakDegPerSecond: Math.round(this.peak * 100) / 100, frames: this.frames, fps, quality: this.quality });
    this.elapsed = 0;
    this.peak = 0;
    this.frames = 0;
  }

  /** The highest speed in the whole log. */
  get peakOverall(): number {
    return Math.max(0, ...this.rows.map((r) => r.peakDegPerSecond));
  }
  /** The rows over the limit; none means the run passes. */
  get failures(): LogRow[] {
    return this.rows.filter((r) => r.peakDegPerSecond > LIMIT_DEG_PER_SECOND);
  }
  csv(): string {
    return ["second,peak_deg_per_second,frames,fps,quality", ...this.rows.map((r) => `${r.second},${r.peakDegPerSecond},${r.frames},${r.fps},${r.quality}`)].join("\n") + "\n";
  }
}

export interface MeasureOptions {
  readonly fps: number;
  readonly fromMs: number;
  readonly toMs: number;
  readonly quality?: QualityLevel;
  /** Frame times, in seconds, replacing the steady one at these frame numbers (stalls). */
  readonly stalls?: ReadonlyMap<number, number>;
}

/** The Node run: the real loop and the real three.js rig (no WebGL), the class clock stepping by the frame time used. */
export function measure(tokens: SceneTokens, o: MeasureOptions): FrameLog {
  const quality = o.quality ?? "High";
  const [loop, rig, log] = [new RigLoop(tokens), new SceneRig(tokens), new FrameLog(quality)];
  let classMs = o.fromMs;
  for (let n = 0; classMs < o.toMs; n++) {
    const feed = feedAt(classMs);
    const draw = loop.step(feed, n === 0 ? 0 : (o.stalls?.get(n) ?? 1 / o.fps), quality);
    rig.apply(draw, quality);
    log.add(draw, rig.measuredDirections(), feed.songIndex);
    classMs += draw.dtSeconds * 1000;
  }
  return log;
}
