// Guard: the update module is pure (ADR 0014, section 5; issue #797). It imports no Electron, no
// `node:` module, no package, and reaches no fetch, DOM, process or timer; every file stays within
// the 150 lines of a pure rule module. Its runtime imports stay inside core/update.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { REPO } from "./fixtures.ts";
import { closure, graphOf } from "./import-graph.ts";

const SRC = join(REPO, "player", "app", "src");
const UPDATE = join(SRC, "core", "update");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const key = (p: string): string => relative(SRC, p).split(sep).join("/");
const sources = files(UPDATE).map((p) => ({ path: key(p), text: readFileSync(p, "utf8") }));

// Comments may name what the module avoids ("the main process fetches"); the guard reads code only.
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SPECIFIER = /(?:^|[\n;])\s*(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;
const FORBIDDEN =
  /\b(?:electron|fetch|XMLHttpRequest|WebSocket|EventSource|window|document|navigator|localStorage|globalThis|self|process|require|setTimeout|setInterval|Date|performance|crypto)\b|node:|\bimport\s*\(/;

/** What is wrong with one file's text; empty when it is pure. */
function problems(text: string): string[] {
  const c = code(text);
  const out = [...c.matchAll(SPECIFIER)].map((m) => m[1]!).filter((s) => !s.startsWith("./") && !s.startsWith("../")).map((s) => `imports ${s}`);
  const hit = FORBIDDEN.exec(c);
  if (hit) out.push(`uses ${hit[0]}`);
  return out;
}

test("the update module has its files", () => {
  assert.deepEqual(sources.map((s) => s.path).sort(), [
    "core/update/class-gate.ts", "core/update/feed-address.ts", "core/update/feed.ts", "core/update/rollback.ts", "core/update/semver.ts",
    "core/update/settings.ts", "core/update/status.ts", "core/update/view.ts", "core/update/words.ts",
  ]);
});

test("no file of the update module imports or reaches any I/O", () => {
  for (const s of sources) assert.deepEqual(problems(s.text), [], s.path);
});

test("its runtime imports stay inside core/update (type-only imports carry nothing)", () => {
  const all = new Map(files(SRC).filter((p) => p.endsWith(".ts")).map((p) => [key(p), readFileSync(p, "utf8")]));
  const reached = [...closure(graphOf(all), sources.map((s) => s.path))].filter((p) => !p.startsWith("core/update/"));
  assert.deepEqual(reached, []);
});

test("each file stays within 150 lines", () => {
  for (const s of sources) assert.ok(s.text.split("\n").length <= 150, `${s.path}: ${s.text.split("\n").length} lines`);
});

test("the guard itself catches what it looks for", () => {
  const caught = [
    'import { app } from "electron";',
    'import { readFileSync } from "node:fs";',
    'import type { Agent } from "node:https";',
    'import semver from "semver";',
    "const r = await fetch(url);",
    "const t = globalThis.fetch;",
    "document.title = v;",
    "window.open(u);",
    "process.env.FEED;",
    'const fs = require("fs");',
    'const m = await import("./x.ts");',
    "setTimeout(check, 1000);",
    "const now = Date.now();",
  ];
  for (const text of caught) assert.notDeepEqual(problems(text), [], text);
  const clean = ['import { parseVersion } from "./semver.ts";', 'import type { Status } from "../clock/clock.ts";', "// the main process fetches", "/* no fetch here */ const a = 1;", 'const u = "https://github.com/x";'];
  for (const text of clean) assert.deepEqual(problems(text), [], text);
});
