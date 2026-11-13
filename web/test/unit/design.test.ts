// The design tokens (docs/design/system.md): shipped unchanged from the reference copy, the palette
// check C9, the zone names, and the lane's independence from the player.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ZONES, isZone, zoneClass, zoneToken } from "../../src/design/zones.ts";
import { checkPalette } from "../lib/palette.ts";
import { impurities } from "../lib/core-purity.ts";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tokens = readFileSync(join(WEB, "src", "design", "tokens.css"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const REMOTE = /^\s*(?:https?:)?\/\//i;

/** Decodes the CSS escapes of one captured value: `\68 ttps` is `https`, `\/` is `/`; CRLF, CR and FF count as LF and a backslash-newline is a continuation. */
function decodeCssEscapes(value: string): string {
  return value
    .replace(/\r\n|[\r\f]/g, "\n")
    .replace(/\\\n/g, "")
    .replace(/\\(?:([0-9a-f]{1,6})[ \t\n]?|([^\n0-9a-f]))/gi, (_m, hex?: string, ch?: string) => {
      if (ch !== undefined) return ch;
      const cp = parseInt(hex ?? "0", 16);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "�";
    });
}

/** Decodes the HTML character references an attribute value may use: `&#x68;ttps`, `&#104;`, `&colon;`, `&sol;`. */
function decodeHtmlRefs(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
    .replace(/&colon;/gi, ":")
    .replace(/&sol;/gi, "/")
    .replace(/&amp;/gi, "&");
}

// A CSS token that may hold escapes: a hex escape swallows one whitespace after it, so it is matched whole.
const cssToken = (stop: string): string => `(?:\\\\[0-9a-f]{1,6}(?:\\r\\n|[ \\t\\n\\r\\f])?|\\\\(?:\\r\\n|[\\s\\S])|[^${stop}\\\\])+`;
const FONT_URL = new RegExp(`url\\(\\s*["']?\\s*(${cssToken(`)"'\\s`)})`, "gi");
const IMPORT = new RegExp(`@import(?:\\s|/\\*[\\s\\S]*?\\*/)*(?:url\\(\\s*)?["']?\\s*(${cssToken(`)"';\\s`)})`, "gi");

/**
 * Remote font references in a CSS or HTML text: a remote url() in an @font-face, a remote @import, a remote <link href>.
 * The structure is found in the raw text; only a captured CSS value is CSS-decoded and only a <link> href is HTML-decoded.
 */
function remoteFontRefs(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/@font-face\s*\{[^}]*\}/gi))
    for (const u of m[0].matchAll(FONT_URL)) {
      const url = decodeCssEscapes(u[1] ?? "");
      if (REMOTE.test(url)) found.push(url);
    }
  for (const m of text.matchAll(IMPORT)) {
    const url = decodeCssEscapes(m[1] ?? "");
    if (REMOTE.test(url)) found.push(url);
  }
  for (const m of text.matchAll(/<link\b[^>]*>/gi)) {
    const href = decodeHtmlRefs(/\bhref\s*=\s*["']?\s*([^"'\s>]+)/i.exec(m[0])?.[1] ?? "");
    if (REMOTE.test(href)) found.push(href);
  }
  return found;
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

  it("nothing in src imports from player/", () => {
    for (const p of sources) {
      const text = readFileSync(p, "utf8");
      const name = relative(WEB, p);
      assert.doesNotMatch(text, /from\s+["'][^"']*\/player\//, `${name} imports from player/`);
    }
  });

  it("no CSS or HTML file loads a remote font (@font-face, @import or <link>); bundled fonts and fetch in code stay fine", () => {
    for (const p of sources.filter((f) => /\.(css|html)$/.test(f))) assert.deepEqual(remoteFontRefs(readFileSync(p, "utf8")), [], relative(WEB, p));
    assert.deepEqual(remoteFontRefs("@font-face{font-family:A;src:url(./fonts/a.woff2) format('woff2')}"), []);
    assert.deepEqual(remoteFontRefs("@font-face{src:url('https://x.test/a.woff2')}"), ["https://x.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs("@font-face{src:local(A),url( //x.test/a.woff2 )}"), ["//x.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs('@import url("https://fonts.test/css");'), ["https://fonts.test/css"]);
    assert.deepEqual(remoteFontRefs('<link rel="stylesheet" href="https://fonts.test/css">'), ["https://fonts.test/css"]);
    assert.deepEqual(remoteFontRefs('<link rel="preload" as="font" href="//f.test/a.woff2">'), ["//f.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs('<link rel="stylesheet" href="./room/room.css">'), []);
    // Whitespace after the opening quote, and CSS escapes, do not hide a remote reference.
    assert.deepEqual(remoteFontRefs('<link rel="stylesheet" href=" https://fonts.test/css">'), ["https://fonts.test/css"]);
    assert.deepEqual(remoteFontRefs("<link rel=stylesheet href=' //f.test/a.woff2'>"), ["//f.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs("@font-face{src:url( ' https://x.test/a.woff2')}"), ["https://x.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs('@import " https://fonts.test/css";'), ["https://fonts.test/css"]);
    assert.deepEqual(remoteFontRefs("@font-face{src:url(\\68 ttps://x.test/a.woff2)}"), ["https://x.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs("@font-face{src:url('\\000068ttps://x.test/a.woff2')}"), ["https://x.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs('@import url("\\68\\74tps://fonts.test/css");'), ["https://fonts.test/css"]);
    assert.deepEqual(remoteFontRefs('@import "\\68 ttps:\\/\\/fonts.test/css";'), ["https://fonts.test/css"]);
    assert.deepEqual(remoteFontRefs("@font-face{src:url(\\2f \\2f x.test/a.woff2)}"), ["//x.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs("@font-face{src:url(./fonts/\\61.woff2)}"), []);
    // A decoded character never moves the structure: `\7d` is not a closing brace, `\3e` not a closing bracket.
    assert.deepEqual(remoteFontRefs("@font-face{src:local(a\\7d ),url(https://x.test/a.woff2)}"), ["https://x.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs('<link rel="stylesheet" title="a\\3e " href="https://fonts.test/css">'), ["https://fonts.test/css"]);
    // CRLF or FF after a hex escape, and a backslash-newline continuation.
    assert.deepEqual(remoteFontRefs("@font-face{src:url(\\68\r\nttps://x.test/a.woff2)}"), ["https://x.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs("@font-face{src:url(\\68\fttps://x.test/a.woff2)}"), ["https://x.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs("@font-face{src:url(ht\\\ntps://x.test/a.woff2)}"), ["https://x.test/a.woff2"]);
    assert.deepEqual(remoteFontRefs('@import "ht\\\r\ntps://fonts.test/css";'), ["https://fonts.test/css"]);
    // HTML character references in a <link href>, and a comment after @import.
    assert.deepEqual(remoteFontRefs('<link rel="stylesheet" href="&#x68;ttps&colon;&sol;&sol;fonts.test/css">'), ["https://fonts.test/css"]);
    assert.deepEqual(remoteFontRefs('<link rel="stylesheet" href="&#104;ttps://fonts.test/css">'), ["https://fonts.test/css"]);
    assert.deepEqual(remoteFontRefs('@import/**/"https://fonts.test/css";'), ["https://fonts.test/css"]);
    assert.deepEqual(remoteFontRefs("@import /* x */ url(https://fonts.test/css);"), ["https://fonts.test/css"]);
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
    for (const f of ["adapter", "fit", "format", "score", "link-text", "intro-model", "beat-schedule", "model", "input"]) {
      // Comments may say "window" or "document"; code may not use them.
      const text = readFileSync(join(WEB, "src", "room", `${f}.ts`), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      assert.doesNotMatch(text, /from\s+["'](node:|\.\/dom|\.\/render|\.\/mount)/, f);
      assert.doesNotMatch(text, /\b(document|window|localStorage|requestAnimationFrame)\b/, f);
    }
  });

  it("the companion's core imports no DOM or I/O", () => {
    const dir = join(WEB, "src", "companion", "core");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    assert.ok(files.length >= 10);
    for (const f of files) assert.deepEqual(impurities(f, readFileSync(join(dir, f), "utf8")), [], f);
  });

  it("the purity check sees every way in to a module and every DOM or I/O global", () => {
    const caught: readonly (readonly [string, string])[] = [
      ['import "../store.ts";', 'import "../store.ts"'],
      ['import { x } from "../net.ts";', 'import "../net.ts"'],
      ['export { y } from "../socket.ts";', 'export from "../socket.ts"'],
      ['export * from "node:fs";', 'export from "node:fs"'],
      ['const m = await import("./clock.ts");', "dynamic import()"],
      ['import fs = require("node:fs");', 'import = require "node:fs"'],
      ['type T = import("../app.ts").App;', 'import type "../app.ts"'],
      ["const u = import.meta.url;", "import.meta"],
      ["const g = globalThis;", "global globalThis"],
      ["const d = document.body;", "global document"],
      ["const w = window;", "global window"],
      ["void fetch('/x');", "global fetch"],
      ["localStorage.getItem('k');", "global localStorage"],
      ["const t = Date.now();", "global Date"],
      ["setTimeout(() => 0, 1);", "global setTimeout"],
    ];
    for (const [src, problem] of caught) assert.ok(impurities("probe.ts", src).includes(problem), `${src} -> ${JSON.stringify(impurities("probe.ts", src))}`);
    // Names in member and key positions are not references to the globals.
    assert.deepEqual(impurities("probe.ts", 'import { a } from "./shape.ts";\nconst o = { fetch: 1, document: 2 };\nconst v = o.fetch + a.history;'), []);
  });
});
