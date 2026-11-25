// The renderer applies the quality monitor (scene.md "Quality levels"): its frame loop steps the level down on a low
// frame rate, logs a row a second, and at Plain stops and hands over. A fake host, no WebGL, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { feedAt } from "../demo/scenario.ts";
import type { QualityLevel, SecondRow } from "../../model/src/index.ts";
import { QUALITY } from "../../model/src/index.ts";
import type { Host } from "../src/host.ts";
import { SceneRenderer } from "../src/renderer.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();

/** A host whose frames the test fires by hand, at the frame time it chooses. */
function fakeHost() {
  let pending: ((nowMs: number) => void) | null = null;
  let requests = 0;
  let frames = 0;
  const ratios: number[] = [];
  const host: Host = {
    painter: { setPixelRatio: (r) => ratios.push(r), setSize: () => undefined, render: () => undefined, dispose: () => undefined },
    size: () => ({ width: 1280, height: 720, pixelRatio: 1 }),
    onResize: () => () => undefined,
    schedule: (cb) => { pending = cb; requests++; return () => { pending = null; }; },
  };
  return {
    host, ratios,
    get requests() { return requests; },
    get frames() { return frames; },
    get scheduled() { return pending !== null; },
    /** Run frames at `fps` for `seconds`, from `fromMs`; returns the time after the last one. */
    run(fps: number, seconds: number, fromMs: number): number {
      let t = fromMs;
      for (let i = 0; i <= Math.round(fps * seconds) && pending; i++) { const cb = pending; pending = null; frames++; t = fromMs + (i * 1000) / fps; cb(t); }
      return t + 1000 / fps;
    },
  };
}

function setup(options: { adapt?: boolean; quality?: QualityLevel } = {}) {
  const h = fakeHost();
  const rows: SecondRow[] = [];
  const levels: (QualityLevel | "Plain")[] = [];
  const framesAt: number[] = [];
  const r = new SceneRenderer(h.host, { tokens, onSecond: (row) => rows.push(row), onLevel: (l) => { levels.push(l); framesAt.push(h.frames); }, ...options });
  r.start(() => feedAt(20_000));
  return { h, r, rows, levels, framesAt };
}

test("a low frame rate steps High to Medium to Low, each time applying the level's render scale, then hands over at Plain and stops", () => {
  const { h, rows, levels, framesAt } = setup();
  assert.equal(h.ratios.at(-1), QUALITY.High.renderScale);
  let t = h.run(40, 5.5, 0);
  assert.deepEqual(levels, ["Medium"]);
  assert.equal(h.ratios.at(-1), QUALITY.Medium.renderScale);
  t = h.run(30, 5.5, t);
  assert.deepEqual(levels, ["Medium", "Low"]);
  assert.equal(h.ratios.at(-1), QUALITY.Low.renderScale);
  assert.equal(h.scheduled, true);
  h.run(20, 5.5, t);
  assert.deepEqual(levels, ["Medium", "Low", "Plain"]);
  assert.equal(h.scheduled, false, "no further frame is asked for at Plain");
  assert.equal(h.frames, framesAt.at(-1), "the run offered more frames, and none was run after the one that reached Plain");
  assert.equal(h.requests, h.frames, "no frame was asked for after the one that reached Plain");
  assert.ok(rows.some((r) => r.level === "Low") && rows.every((r) => r.fps > 0));
});

test("a short dip steps nothing and 60 fps keeps High", () => {
  const { h, levels } = setup();
  let t = h.run(60, 3, 0);
  t = h.run(20, 3, t);
  h.run(60, 10, t);
  assert.deepEqual(levels, []);
});

test("the once-a-second log carries the fps and the level the second was drawn at", () => {
  const { h, rows } = setup();
  h.run(60, 3.2, 0);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.level === "High" && Math.abs(r.fps - 60) < 0.5));
});

test("adapt false keeps the level whatever the frame rate (the demo's CI runs) (and logs nothing: the monitor is off)", () => {
  const { h, rows, levels } = setup({ adapt: false });
  h.run(10, 20, 0);
  assert.deepEqual(levels, []);
  assert.deepEqual(rows, []);
});

test("a person's setQuality restarts the count at the chosen level", () => {
  const { h, r, levels } = setup();
  let t = h.run(40, 4, 0);
  r.setQuality("Medium");
  t = h.run(40, 4, t); // 4 s at Medium (limit 45): not yet 5 s since the choice
  assert.deepEqual(levels, []);
  h.run(40, 2, t);
  assert.deepEqual(levels, ["Low"]);
});

test("after Plain, start and setQuality refuse: the scene does not come back and the level does not rise", () => {
  const { h, r, levels } = setup({ quality: "Low" });
  h.run(10, 6, 0);
  assert.deepEqual(levels, ["Plain"]);
  const ratio = h.ratios.at(-1);
  r.setQuality("High");
  assert.equal(h.ratios.at(-1), ratio, "no new render scale");
  r.start(() => feedAt(20_000));
  assert.equal(h.scheduled, false, "start does not bring the loop back");
});

test("a computer drawing a frame every 2.1 s still walks to Plain through the renderer", () => {
  const { h, levels } = setup();
  let t = 0;
  for (let i = 0; i < 40 && !levels.includes("Plain"); i++) { t = h.run(1 / 2.1, 0, t); }
  assert.deepEqual(levels, ["Medium", "Low", "Plain"]);
});
