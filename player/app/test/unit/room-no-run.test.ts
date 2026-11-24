// S6 (room-2d.md, "Motion and reduced motion"): the control band and the join sheet run nothing. Their style
// sheets hold no transition, no animation and no keyframes, and read none of the shared motion tokens
// (`--m-change`, `--m-flash`, `--m-state`, which other screens keep reading). Comments are not code.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { REPO } from "./fixtures.ts";

const RENDERER = join(REPO, "player", "app", "src", "renderer");
const code = (file: string): string => readFileSync(join(RENDERER, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

for (const file of ["room-band.css", "room-join.css"]) {
  test(`${file}: no transition, no animation, no keyframes, no motion token`, () => {
    const css = code(file);
    assert.doesNotMatch(css, /transition/i);
    assert.doesNotMatch(css, /animation/i);
    assert.doesNotMatch(css, /@keyframes/i);
    assert.doesNotMatch(css, /--m-(change|flash|state)/);
    assert.doesNotMatch(css, /\bfading\b/);
  });
}

test("the band's and the sheet's scripts set no style that runs", () => {
  for (const file of ["room-band.ts", "room-join.ts", "room-marks.ts"]) {
    const src = readFileSync(join(RENDERER, file), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /\.animate\(|requestAnimationFrame|style\.(transition|animation)|classList\.add\(["']fad/, file);
  }
});
