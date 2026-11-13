// The site renders text only through textContent (src/site/ui/dom.ts): no source file in
// src/site uses an API that turns a string into markup (#257).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../../src/site", import.meta.url));

const MARKUP = [
  /\binnerHTML\b/,
  /\bouterHTML\b/,
  /\binsertAdjacentHTML\b/,
  /\bdocument\s*\.\s*write(ln)?\b/,
  /\bcreateContextualFragment\b/,
  /\bDOMParser\b/,
  /\bsetHTML(Unsafe)?\b/,
  /\bparseHTML(Unsafe)?\b/,
  /\bsrcdoc\b/,
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|html)$/.test(e.name) ? [join(dir, e.name)] : []));
}

describe("rendering in src/site", () => {
  it("never turns a string into markup", () => {
    const all = files(SITE);
    assert.ok(all.length > 10, "the site's sources were not found");
    for (const f of all) {
      const src = readFileSync(f, "utf8");
      for (const bad of MARKUP) assert.doesNotMatch(src, bad, `${relative(SITE, f)} uses ${bad.source}`);
    }
  });

  it("sets text with textContent in its one text helper", () => {
    const dom = readFileSync(join(SITE, "ui", "dom.ts"), "utf8");
    assert.match(dom, /\.textContent = text;/);
  });
});
