// Rule guards (plan section 3) and code structure rules (CLAUDE.md), checked on the source.
// Rule 2: no equipment control. Rule 3: no audio playback, no Spotify interface.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { REPO } from "./fixtures.ts";

const SRC = join(REPO, "player", "app", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const sources = files(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, "utf8") }));
// Comments may name a rule; the guard looks at code only.
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/<!--[\s\S]*?-->/g, "");

const FORBIDDEN: readonly [string, RegExp][] = [
  ["audio playback (rule 3)", /\bnew\s+Audio\b|<audio\b|<video\b|\bAudioContext\b|\bwebkitAudioContext\b|\bMediaSource\b|\.play\(\)/],
  ["a Spotify interface (rule 3)", /spotify\.com|api\.spotify|sdk\.scdn|Spotify\.Player|spotify-web-api/i],
  ["equipment control (rule 2)", /\bwriteValue\w*\(|\bnavigator\.bluetooth\b|\bnavigator\.usb\b|\bnavigator\.serial\b|\bnavigator\.hid\b|\bresistance\b|\bincline\s*=|\bsetSpeed\b|\bbrake\b/i],
  ["a network request", /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|\bnet\.request\b|node:https?\b|require\(["']https?["']\)/],
];

for (const [what, re] of FORBIDDEN) {
  test(`no ${what} anywhere in the app's source`, () => {
    const hits = sources.filter((s) => re.test(code(s.text))).map((s) => s.path);
    assert.deepEqual(hits, []);
  });
}

test("the guard itself catches what it looks for", () => {
  assert.match(code("const a = new Audio('x');"), FORBIDDEN[0][1]);
  assert.match(code("c.writeValueWithResponse(buf)"), FORBIDDEN[2][1]);
  assert.doesNotMatch(code("// new Audio() is never used"), FORBIDDEN[0][1]);
});

const IO = /from\s+["'](electron|node:fs|node:fs\/promises|fs|node:net|node:http|node:https|node:child_process|node:path|node:os|node:perf_hooks)["']|\b(window|document|process)\./;

test("the core is pure: no Electron, filesystem, network, process or DOM", () => {
  const hits = sources.filter((s) => s.path.startsWith("core") && IO.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(hits, []);
});

test("source files stay under about 300 lines (150 for the clock and link rule modules)", () => {
  for (const s of sources) {
    const lines = s.text.split("\n").length;
    const cap = s.path.startsWith(join("core", "clock")) || s.path.startsWith(join("core", "link")) ? 150 : 300;
    assert.ok(lines <= cap, `${s.path}: ${lines} lines`);
  }
});

test("nothing is imported from the spikes", () => {
  const hits = sources.filter((s) => /spikes?\//.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(hits, []);
});
