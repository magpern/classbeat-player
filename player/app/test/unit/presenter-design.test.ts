// The presenter's style sheet keeps the design (#682; presenter.md, riders-panel.md, system.md): it
// takes its colours from the tokens, sets no colour of its own, nothing animates, no text is set
// below 15 px, and it names no font face the page may not load (font-src 'none'). The built sheet
// carries the tokens' properties and none of their @font-face rules.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p: string[]): string => readFileSync(join(APP, ...p), "utf8");
const css = read("src", "renderer", "presenter.css");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

test("the presenter's sheet takes every colour from the tokens: no hue, no literal colour", () => {
  assert.match(css, /@import "\.\/design\/tokens\.css"/);
  assert.doesNotMatch(code, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(red|green|blue|yellow|orange|purple|teal)\b/i);
  assert.doesNotMatch(code, /--zone/, "the presenter's panels carry no zone");
  assert.doesNotMatch(code, /url\(|@font-face|@import (?!"\.\/design\/tokens\.css")/, "nothing else is loaded");
});

test("the presenter's sheet names no face the page may not load", () => {
  assert.doesNotMatch(code, /--face-(text|number)|Big Shoulders|Atkinson/);
});

test("nothing animates: no transition, animation or smooth scrolling", () => {
  assert.doesNotMatch(code, /transition|animation|@keyframes|scroll-behavior\s*:\s*smooth/);
});

test("no text is set below 15 px, and every control is at least 44 px high", () => {
  const sizes = [...code.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 5);
  assert.ok(Math.min(...sizes) >= 15, `smallest ${Math.min(...sizes)}`);
  assert.match(code, /button\s*\{[^}]*min-height:\s*44px/);
});

test("the built sheet keeps the tokens' properties and drops their font faces", { skip: !existsSync(join(APP, "dist", "presenter.css")) && "needs npm run build" }, () => {
  const built = read("dist", "presenter.css");
  assert.match(built, /--light-1:\s*#f6f4ef/);
  assert.doesNotMatch(built, /@font-face|url\(|woff2/);
});
