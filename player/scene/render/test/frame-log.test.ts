// Scope items 2 and 3 on the renderer's own loop and the real three.js rig (no WebGL): the beams'
// speed is measured on what the rig holds, every second, at 30, 60 and 144 fps and with stalled
// frames, through a phrase flip, a song change from a mirrored phrase and a build with its drop.
// The run also writes the CI frame log (artifacts/frame-log.csv).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { feedAt } from "../demo/scenario.ts";
import { RigLoop } from "../src/loop.ts";
import { FrameLog, LIMIT_DEG_PER_SECOND, measure } from "../tools/frame-log.ts";
import { RENDER_DIR, tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
// 10 s to 70 s: the phrase flip at 16 s, the build at 36 s, the drop at 40 s, the song change at 60 s.
const RUN = { fromMs: 10_000, toMs: 70_000 } as const;

for (const fps of [30, 60, 144]) {
  test(`${fps} fps: no second has a beam over 30 degrees a second, and the run plays every transition`, () => {
    const log = measure(tokens, { fps, ...RUN });
    assert.deepEqual(log.failures, []);
    assert.ok(log.rows.length >= 58);
    assert.ok(log.seen.phraseFlips >= 1 && log.seen.songChangesFromMirrored >= 1 && log.seen.gathers >= 1 && log.seen.drops >= 1, JSON.stringify(log.seen));
    assert.ok(log.peakOverall >= 29 && log.peakOverall <= LIMIT_DEG_PER_SECOND, `the beams do turn at the limit: ${log.peakOverall}`);
    assert.ok(log.rows.every((r) => Math.abs(r.fps - fps) < fps * 0.1), "the log's frame rate is the run's");
    if (fps === 60) {
      const dir = join(RENDER_DIR, "artifacts");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "frame-log.csv"), log.csv());
    }
  });
}

test("stalled frames of 250 ms and 1 s are clamped: the measured speed stays within the limit", () => {
  const stalls = new Map<number, number>();
  for (let n = 40; n < 3600; n += 97) stalls.set(n, n % 2 === 0 ? 0.25 : 1);
  const log = measure(tokens, { fps: 60, ...RUN, stalls });
  assert.deepEqual(log.failures, []);
});

test("at the lower quality levels too", () => {
  for (const quality of ["Medium", "Low"] as const) {
    const log = measure(tokens, { fps: 60, ...RUN, quality });
    assert.deepEqual(log.failures, []);
    assert.ok(log.rows.every((r) => r.quality === quality));
  }
});

test("the check measures something: the model's targets, undrawn, would fail it", () => {
  const [loop, log] = [new RigLoop(tokens), new FrameLog("High")];
  let classMs = RUN.fromMs;
  for (let n = 0; classMs < RUN.toMs; n++) {
    const feed = feedAt(classMs);
    const draw = loop.step(feed, n === 0 ? 0 : 1 / 60, "High");
    log.add(draw, draw.frame.directions, feed.songIndex); // the targets, as if drawn without the limiter
    classMs += draw.dtSeconds * 1000;
  }
  assert.ok(log.failures.length >= 3, `${log.failures.length} seconds over the limit, peak ${log.peakOverall}`);
  assert.ok(log.peakOverall > 1000);
});
