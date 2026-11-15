// What the scene is handed by its host (the demo page now, the shell's room window later), and
// all it may reach: a painter, the drawing size, a frame scheduler and a resize subscription.
// `src/` never receives the canvas, `window` or `document`: the host builds the three.js renderer
// from its own canvas and passes only this. Types only.

import type { PerspectiveCamera, Scene } from "three";

/** What the scene asks of the three.js renderer the host built (a `WebGLRenderer` has all of it). */
export interface Painter {
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
}

export interface HostSize {
  /** Drawing width and height in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** The display's pixel ratio; the scene scales it by the quality level's render scale. */
  readonly pixelRatio: number;
}

export interface Host {
  readonly painter: Painter;
  size(): HostSize;
  /** Calls `listener` when the drawing size changes; returns how to stop. */
  onResize(listener: () => void): () => void;
  /** Calls `callback` once on the next frame, with a monotonic time in ms; returns how to cancel. */
  schedule(callback: (nowMs: number) => void): () => void;
}
