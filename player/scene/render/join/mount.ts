// The room window's host for the scene: finds the canvas and the text layer's root the page holds
// (room.html), builds the three.js renderer from that canvas, hands the scene only a `Host`
// (src/host.ts), and gives `startJoin` its ports. The only file of the join that touches the page.
// The plain 2D screen is the web lane's and is not touched here: it stays mounted underneath, and
// `data-scene` on the document element says which of the two the stylesheet shows.
import { WebGLRenderer } from "three";
import type { Host } from "../src/host.ts";
import { SceneRenderer } from "../src/renderer.ts";
import { readSceneTokens } from "../src/tokens.ts";
import type { Shown } from "../src/text-clock.ts";
import type { TextBox } from "../src/text-box.ts";
import { textView } from "../src/text-view-calc.ts";
import { mergeTextClass } from "../src/text-merge-calc.ts";
import type { TextClass } from "../src/text-types.ts";
import { TextLayer } from "../layer/text-layer.ts";
import type { Join, JoinOptions, JoinPorts, SceneHandle } from "./scene-join.ts";
import { startJoin } from "./scene-join.ts";

export interface MountOptions extends JoinOptions {
  /** Whether the window can be seen (the page's visibility); the join reads no document member itself. */
  readonly visible: () => boolean;
}

/** The text layer and the scene on one canvas, drawn from the join's frames as the demo page draws them. */
function createHandle(canvas: HTMLCanvasElement, onLost: () => void): SceneHandle {
  const tokens = readSceneTokens(getComputedStyle(document.documentElement));
  if (tokens.missing.length > 0) throw new Error(`the page lacks scene tokens: ${tokens.missing.join(", ")}`);
  const gl = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); onLost(); });
  gl.setClearColor(0x000000, 1);
  const host: Host = {
    painter: { setPixelRatio: (r) => gl.setPixelRatio(r), setSize: (w, h) => gl.setSize(w, h, false), render: (scene, camera) => gl.render(scene, camera), dispose: () => gl.dispose() },
    size: () => ({ width: canvas.clientWidth || window.innerWidth, height: canvas.clientHeight || window.innerHeight, pixelRatio: window.devicePixelRatio || 1 }),
    onResize: (listener) => { window.addEventListener("resize", listener); return () => window.removeEventListener("resize", listener); },
    schedule: (callback) => { const id = window.requestAnimationFrame(callback); return () => window.cancelAnimationFrame(id); },
  };
  const renderer = new SceneRenderer(host, { tokens });
  const layer = new TextLayer();
  let merged: { readonly from: TextClass; readonly made: TextClass } | null = null;
  let boxes: readonly TextBox[] = [];
  let shown: Shown | null = null;
  let dirty = true;
  const mergedOf = (cls: TextClass): TextClass => {
    if (merged === null || merged.from !== cls) merged = { from: cls, made: mergeTextClass(cls) };
    return merged.made;
  };
  return {
    setQuality: (level) => renderer.setQuality(level),
    frame({ feed, text }, nowMs) {
      // The text first: it shows the class as the last frame mark had it (text rule 2), and the mask needs its boxes before the draw.
      const s = renderer.textAt(feed);
      if (s.changed || shown === null) dirty = true;
      shown = s;
      if (dirty) {
        dirty = false;
        layer.update(textView({ cls: mergedOf(text), classMs: s.classMs, songIndex: s.songIndex, songPosMs: s.songPosMs, link: s.link, reducedMotion: s.reducedMotion, playlistNotLoaded: s.playlistNotLoaded === true, aspect: window.innerWidth / Math.max(1, window.innerHeight) }));
        const next = layer.boxes();
        if (next !== boxes) { boxes = next; renderer.setTextBoxes(next); }
      }
      renderer.frame(feed, nowMs);
    },
    dispose() {
      renderer.dispose();
    },
  };
}

/** Starts the scene in the room window; the plain screen shows until a frame is drawn, and whenever the scene cannot be. */
export function mountScene(options: MountOptions): Join {
  const canvas = document.getElementById("scene") as HTMLCanvasElement | null;
  const root = document.documentElement;
  const ports: JoinPorts = {
    now: () => performance.now(),
    schedule: (callback) => { const id = window.requestAnimationFrame(callback); return () => window.cancelAnimationFrame(id); },
    later: (run, ms) => { const id = setTimeout(run, ms); return () => clearTimeout(id); },
    create: (onLost) => {
      if (canvas === null) throw new Error("the page has no #scene canvas");
      return createHandle(canvas, onLost);
    },
    show: (mode) => { root.dataset.scene = mode === "scene" ? "on" : "off"; },
    visible: options.visible,
  };
  root.dataset.scene = "off";
  return startJoin(ports, options);
}
