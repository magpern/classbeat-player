// The room window mounts the scene (#677, S10, S11): the page holds the canvas and the text layer's root, the script starts the
// join with the same reduced-motion value the plain screen gets, and every frame the plain screen draws is also pushed to the join.
// The join itself (reduced motion, kills, the 2 s deadline) is tested in player/scene/render/test/scene-join.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const dir = join(import.meta.dirname, "..", "..", "src", "renderer");
const ts = readFileSync(join(dir, "room.ts"), "utf8");
const html = readFileSync(join(dir, "room.html"), "utf8");

test("room.html holds the scene's canvas and the text layer's root, and no new source for the page's policy", () => {
  assert.match(html, /<canvas id="scene"><\/canvas>/);
  assert.match(html, /<div id="text"><\/div>/);
  assert.match(html, /script-src 'self'; style-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|blob:|data:/);
});

test("room.ts starts the join with the plain screen's own reduced-motion value and feeds it every frame", () => {
  assert.match(ts, /mountScene\(\{ reducedMotion, visible:/);
  assert.match(ts, /screen\.update\(frame\);\s*scene\.push\(frame\);/);
});

test("the scene's root goes after the plain screen in the document, so the plain screen's parts are found first", () => {
  assert.match(ts, /document\.body\.append\(sceneRoot\)/);
});
