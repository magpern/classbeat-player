// Guard: the update module is pure (ADR 0014, section 5; issue #797). It imports no Electron, no
// `node:` module, no package, and reaches no fetch, DOM, process or timer; every file stays within
// the 150 lines of a pure rule module. Its runtime imports stay inside core/update.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { REPO } from "./fixtures.ts";
import { closure, graphOf } from "./import-graph.ts";
import { type Check, type Mutation, mutationGaps, oldView, slashCode, type Views, withSource } from "./rule-sources.ts";

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

// Comments may name what the module avoids ("the main process fetches"); the guard reads code only,
// in two views (rule-sources.ts, issue #861): `slashCode`, as before, and the file with only its real
// comments out, so a "//" in a string hides nothing from it.
const SPECIFIER = /(?:^|[\n;])\s*(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;
const FORBIDDEN =
  /\b(?:electron|fetch|XMLHttpRequest|WebSocket|EventSource|window|document|navigator|localStorage|globalThis|self|process|require|setTimeout|setInterval|Date|performance|crypto)\b|node:|\bimport\s*\(/;

/** What is wrong with one file's text, in any of its views; empty when it is pure. */
function problems(text: string, views: Views = withSource(slashCode)): string[] {
  return [...new Set(views(text).flatMap(problemsIn))];
}
function problemsIn(c: string): string[] {
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

test('the guard catches code a "//" in a string hides from the old view (issue #861)', () => {
  const impure: Check = (_path, text, views) => problems(text, views).length > 0;
  const A = "export const MAX_VERSION_LENGTH = 64;";
  const hide = (after: string): string => `${A} const s = "//"; ${after}`;
  const table: readonly Mutation[] = [
    ["impure", "core/update/semver.ts", A, hide('import { readFileSync } from "node:fs";'), true],
    ["impure", "core/update/semver.ts", A, hide('export { x } from "electron";'), true],
    ["impure", "core/update/semver.ts", A, hide("const now = Date.now();"), true],
  ];
  const read = (path: string): string => sources.find((s) => s.path === path)!.text;
  assert.deepEqual(mutationGaps(table, new Map([["impure", impure]]), read, oldView(slashCode)), []);
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
