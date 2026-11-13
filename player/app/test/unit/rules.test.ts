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

// The one exception (owner, 2026-11-13, #173): the host's live connection to our own backend
// (ADR 0005 section 1) may name the runtime's `WebSocket` in main/live/live-socket.ts, and only
// there. It is taken out of the network check alone: audio, Spotify and equipment control stay
// fully enforced in that file, and every other file keeps the full network check.
const LIVE_SOCKET = join("main", "live", "live-socket.ts");
const LIVE_SETUP = join("main", "live", "setup.ts");
const NETWORK = "a network request";
const NETWORK_EXCEPTIONS: ReadonlyMap<string, RegExp> = new Map([[LIVE_SOCKET, /\bWebSocket\b/g]]);
const checked = (path: string, text: string, what: string): string => {
  const strip = what === NETWORK ? NETWORK_EXCEPTIONS.get(path) : undefined;
  return strip ? text.replace(strip, "") : text;
};

for (const [what, re] of FORBIDDEN) {
  test(`no ${what} anywhere in the app's source`, () => {
    const hits = sources.filter((s) => re.test(checked(s.path, code(s.text), what))).map((s) => s.path);
    assert.deepEqual(hits, []);
  });
}

test("the live connection's exception is one file and one word, for the network check only", () => {
  assert.deepEqual([...NETWORK_EXCEPTIONS.keys()], [LIVE_SOCKET]);
  assert.deepEqual([...NETWORK_EXCEPTIONS.values()].map((r) => r.source), ["\\bWebSocket\\b"]);
  const live = sources.find((s) => s.path === LIVE_SOCKET);
  assert.ok(live, "the exception names a file that exists");
  assert.match(code(live.text), /\bWebSocket\b/);
  // In that file every other way onto the network is still a hit.
  for (const bad of ["fetch(u)", "new XMLHttpRequest()", "new EventSource(u)", "net.request(u)", 'import "node:https"', 'require("http")']) {
    assert.match(checked(LIVE_SOCKET, `new WebSocket(u); ${bad}`, NETWORK), FORBIDDEN[3][1], bad);
  }
  // The other rules take no exception there.
  const others: [string, string][] = [["audio playback (rule 3)", "new Audio(x)"], ["a Spotify interface (rule 3)", "api.spotify"], ["equipment control (rule 2)", "c.writeValue(b)"]];
  for (const [what, bad] of others) assert.match(checked(LIVE_SOCKET, `WebSocket ${bad}`, what), FORBIDDEN.find(([w]) => w === what)![1], what);
  // Any other file: the word is a network request.
  for (const path of [join("main", "main.ts"), LIVE_SETUP, join("main", "live", "live-service.ts"), join("renderer", "live-panel.ts")]) {
    assert.match(checked(path, "new WebSocket(u)", NETWORK), FORBIDDEN[3][1], path);
  }
});

test("the live socket reaches only the backend's /api/live/ paths", () => {
  const text = code(sources.find((s) => s.path === LIVE_SOCKET)!.text);
  // It has no address of its own: no scheme or host, and any path is under /api/live/.
  const literals = [...text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]);
  for (const l of literals) {
    assert.doesNotMatch(l, /:\/\/|^wss?:|^https?:/i, l);
    if (l.includes("/")) assert.match(l, /^\/api\/live\//, l);
  }
  // The only address it is handed is the live socket's, built in core/live/host-wire.ts.
  const service = code(sources.find((s) => s.path === join("main", "live", "live-service.ts"))!.text);
  assert.deepEqual([...service.matchAll(/\bconnect\(([^,(]+)\(/g)].map((m) => m[1].trim()), ["liveSocketUrl"]);
  const wire = code(sources.find((s) => s.path === join("core", "live", "host-wire.ts"))!.text);
  assert.deepEqual([...wire.matchAll(/new URL\(("[^"]*")/g)].map((m) => JSON.parse(m[1])), ["/api/live/ws"]);
});

test("only main/live/setup.ts calls into the live socket", () => {
  const valueImport = /^import\s+(?!type\b)[^;]*from\s+["'][^"']*live-socket(?:\.ts)?["']/m;
  const importers = sources.filter((s) => valueImport.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(importers, [LIVE_SETUP]);
  const callers = sources.filter((s) => s.path !== LIVE_SOCKET && /\bwebSocketConnect\b/.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(callers, [LIVE_SETUP]);
});

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
