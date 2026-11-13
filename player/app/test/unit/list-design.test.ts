// The class list's page keeps the design (docs/design/system.md, class-list.md): the tokens are
// the reference copy unchanged, the style sheet uses them and sets no colour of its own, nothing
// animates, no text is set below 14 px, and the page carries its own strict policy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { LIST_CSP } from "../../src/main/web-preferences.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p: string[]): string => readFileSync(join(APP, ...p), "utf8");
const css = read("src", "renderer", "classlist.css");

test("the tokens are the reference copy, unchanged (a value changes in a design pull request first)", () => {
  assert.equal(read("src", "renderer", "design", "tokens.css"), read("..", "..", "docs", "design", "mockups", "tokens.css"));
});

test("the style sheet takes every colour from the tokens: no hue, no literal colour", () => {
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(red|green|blue|yellow|orange|purple|teal)\b/i);
  assert.doesNotMatch(css, /--zone/, "this screen carries no zone");
  assert.match(css, /@import "\.\/design\/tokens\.css"/);
});

test("nothing animates: no transition, animation or smooth scrolling", () => {
  assert.doesNotMatch(css, /transition|animation|@keyframes|scroll-behavior\s*:\s*smooth/);
  assert.doesNotMatch(read("src", "renderer", "classlist.ts"), /behavior:\s*"smooth"|requestAnimationFrame/);
});

test("no text is set below 14 px", () => {
  const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 10);
  assert.ok(Math.min(...sizes) >= 14, `smallest ${Math.min(...sizes)}`);
});

test("classlist.html carries exactly the list page's policy, before any script, and no inline script, style or handler", () => {
  const html = read("src", "renderer", "classlist.html");
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(m, "CSP meta tag missing");
  assert.equal(m[1], LIST_CSP);
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"));
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)|<style|\sstyle=|\son[a-z]+=/i);
  assert.match(LIST_CSP, /style-src 'self'/);
  assert.match(LIST_CSP, /font-src 'self'/);
  assert.doesNotMatch(LIST_CSP, /unsafe-inline|unsafe-eval|https?:|data:|blob:|\*/);
});

test("the page paints text only through textContent", () => {
  for (const f of ["classlist.ts", "list-paint.ts"]) assert.doesNotMatch(read("src", "renderer", f), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.setAttribute\(["']style/);
});
