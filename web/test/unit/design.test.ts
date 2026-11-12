// The design tokens (docs/design/system.md): shipped unchanged from the reference copy, the palette
// check C9, the zone names, and the lane's independence from the player.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ZONES, isZone, zoneClass, zoneToken } from "../../src/design/zones.ts";
import { checkPalette } from "../lib/palette.ts";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tokens = readFileSync(join(WEB, "src", "design", "tokens.css"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("design tokens", () => {
  it("tokens.css is the reference copy, unchanged (a value changes in a design pull request first)", () => {
    const reference = readFileSync(join(WEB, "..", "docs", "design", "mockups", "tokens.css"), "utf8");
    assert.equal(tokens, reference);
  });

  it("the four font files ship with their licences, and no font is fetched", () => {
    const files = readdirSync(join(WEB, "src", "design", "fonts")).sort();
    assert.deepEqual(files, [
      "OFL-atkinson-hyperlegible.txt",
      "OFL-big-shoulders-display.txt",
      "atkinson-hyperlegible-latin-400-normal.woff2",
      "atkinson-hyperlegible-latin-700-normal.woff2",
      "big-shoulders-display-latin-600-normal.woff2",
      "big-shoulders-display-latin-800-normal.woff2",
    ]);
    assert.doesNotMatch(tokens, /https?:/);
  });

  it("C9: every zone is at least 7:1 with black on it, on the stage and lights down; neighbours stay apart for colour-blind riders", () => {
    const rows = checkPalette(tokens);
    assert.equal(rows.filter((r) => r.check.startsWith("zone")).length, 7);
    assert.deepEqual(rows.filter((r) => !r.ok).map((r) => `${r.check}: ${r.detail}`), []);
  });

  it("zones.ts names the seven zone tokens that tokens.css defines", () => {
    for (const z of ZONES) {
      assert.match(tokens, new RegExp(`${zoneToken(z)}:\\s*#[0-9a-f]{6}`, "i"));
      assert.match(tokens, new RegExp(`\\.${zoneClass(z)}\\s*\\{\\s*--zone:\\s*var\\(${zoneToken(z)}\\)`));
    }
    assert.equal(zoneToken(4), "--zone-4");
    assert.equal(zoneClass(7), "z7");
    assert.equal(zoneClass(9), "z7", "an unknown zone is clamped, never left without a colour");
    assert.deepEqual([isZone(0), isZone(1), isZone(7), isZone(8), isZone(2.5)], [false, true, true, false, false]);
  });
});

describe("the web lane stands alone", () => {
  const sources = walk(join(WEB, "src")).filter((p) => /\.(ts|css|html)$/.test(p));

  it("nothing in src imports from player/ or reaches the network", () => {
    for (const p of sources) {
      const text = readFileSync(p, "utf8");
      const name = relative(WEB, p);
      assert.doesNotMatch(text, /from\s+["'][^"']*\/player\//, `${name} imports from player/`);
      assert.doesNotMatch(text, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/, `${name} uses the network`);
      assert.doesNotMatch(text, /https?:\/\//, `${name} names a URL`);
    }
  });

  it("nothing from a class file becomes markup", () => {
    for (const p of sources.filter((f) => f.endsWith(".ts"))) assert.doesNotMatch(readFileSync(p, "utf8"), /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/, relative(WEB, p));
  });

  it("source files stay small and cohesive (CLAUDE.md, code structure)", () => {
    for (const p of sources.filter((f) => f.endsWith(".ts"))) {
      const lines = readFileSync(p, "utf8").split("\n").length;
      assert.ok(lines <= 300, `${relative(WEB, p)} has ${lines} lines`);
    }
  });

  it("the pure modules import no DOM or I/O", () => {
    for (const f of ["adapter", "fit", "format", "score", "link-text", "intro-model", "model", "input"]) {
      // Comments may say "window" or "document"; code may not use them.
      const text = readFileSync(join(WEB, "src", "room", `${f}.ts`), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      assert.doesNotMatch(text, /from\s+["'](node:|\.\/dom|\.\/render|\.\/mount)/, f);
      assert.doesNotMatch(text, /\b(document|window|localStorage|requestAnimationFrame)\b/, f);
    }
  });
});
