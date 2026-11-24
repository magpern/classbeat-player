// The instructor start screen's status row (issue #657, docs/design/app-modes.md): "Up to date" stays on
// one line and the "Unpair this phone" key overlaps nothing, at every size in docs/design/app.md,
// 640x360 and 1024x768 included. No browser runs here, so this guards the rules that give that layout
// and that the app's CSS keeps the reference mock-up's status-row rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]): string => readFileSync(join(HERE, ...p), "utf8");
const app = read("..", "src", "modes", "app.css");
const mock = read("..", "..", "..", "docs", "design", "mockups", "app.css");

/** The declarations of every rule whose selector is exactly `selector`, outside any @media block. */
function decls(css: string, selector: string): string {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{[^{}]*\{[^}]*\}\s*\}/g, "");
  const re = /([^{}]+)\{([^}]*)\}/g;
  const out: string[] = [];
  for (let m = re.exec(flat); m; m = re.exec(flat)) if (m[1].trim() === selector) out.push(m[2]);
  assert.ok(out.length, `rule ${selector}`);
  return out.join(";");
}

test("the status row wraps in every orientation, so no size squeezes the words or the key", () => {
  assert.match(decls(app, ".status"), /flex-wrap:\s*wrap/);
});

test("'Up to date' never breaks across lines (1024x768 gave three, 640x360 two)", () => {
  assert.match(decls(app, ".status .ok"), /white-space:\s*nowrap/);
});

test("the Unpair key keeps its height, and sits at the row's end or on its own full-width line when upright", () => {
  const key = decls(app, ".status .key.quiet");
  assert.match(key, /min-height:\s*64px/);
  assert.match(key, /margin-left:\s*auto/);
  assert.match(key, /white-space:\s*nowrap/);
  assert.match(app, /@media \(orientation: portrait\)\s*\{\s*\.status \.key\.quiet\s*\{\s*flex:\s*1 0 100%;\s*margin-left:\s*0;/);
  // The wrap is not confined to portrait any more.
  assert.doesNotMatch(app, /@media \(orientation: portrait\)\s*\{\s*\.status\s*\{/);
});

test("the app's status-row rules match the reference mock-up's", () => {
  for (const sel of [".status", ".status .ok", ".status .key.quiet"]) {
    const a = decls(app, sel);
    const m = decls(mock, sel);
    for (const d of m.split(";").map((x) => x.trim()).filter(Boolean)) {
      if (sel === ".status" && d.startsWith("flex-wrap")) assert.match(a, /flex-wrap:\s*wrap/);
      else assert.ok(a.includes(d), `${sel} lacks ${d}`);
    }
  }
});
