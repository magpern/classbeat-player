// Every window the shell creates has the hardening of web-preferences.ts (#149, N4): each
// `new BrowserWindow` (and any view that hosts a renderer) in src/ takes `secureWebPreferences(...)`
// as its webPreferences, alone or spread first, adds no key that `secureWebPreferences` sets, and
// no spread after it can replace them. Read from the TypeScript syntax tree, not a pattern.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { secureWebPreferences } from "../../src/main/web-preferences.ts";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
/** Electron classes whose constructor takes webPreferences and starts a renderer. */
const RENDERER_HOSTS = new Set(["BrowserWindow", "BrowserView", "WebContentsView"]);
const HARDENING_KEYS = new Set(Object.keys(secureWebPreferences("x")));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.(c|m)?tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}

const nameOf = (n: ts.PropertyName | undefined): string | null => (n && (ts.isIdentifier(n) || ts.isStringLiteral(n)) ? n.text : null);
const isSecureCall = (e: ts.Expression): boolean => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "secureWebPreferences";

/** The problems with one constructor call, or none. */
function problemsOf(call: ts.NewExpression): string[] {
  const opts = call.arguments?.[0];
  if (!opts || !ts.isObjectLiteralExpression(opts)) return ["its options are not an object literal"];
  const props = opts.properties;
  const at = props.findIndex((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && nameOf(p.name) === "webPreferences");
  if (at < 0) return ["no webPreferences"];
  const out: string[] = [];
  if (props.filter((p) => nameOf(p.name) === "webPreferences").length > 1) out.push("webPreferences twice");
  // A spread after webPreferences could replace it.
  if (props.slice(at + 1).some((p) => ts.isSpreadAssignment(p))) out.push("a spread after webPreferences");
  const wp = props[at]!;
  if (!ts.isPropertyAssignment(wp)) return [...out, "webPreferences is not written out"];
  const v = wp.initializer;
  if (isSecureCall(v)) return out;
  if (!ts.isObjectLiteralExpression(v)) return [...out, "webPreferences is not secureWebPreferences(...)"];
  const [first, ...rest] = v.properties;
  if (!first || !ts.isSpreadAssignment(first) || !isSecureCall(first.expression)) out.push("webPreferences does not start with ...secureWebPreferences(...)");
  for (const p of rest) {
    const key = ts.isPropertyAssignment(p) ? nameOf(p.name) : null;
    if (key === null) out.push(`a ${ts.SyntaxKind[p.kind]} in webPreferences`);
    else if (HARDENING_KEYS.has(key)) out.push(`overrides ${key}`);
  }
  return out;
}

function rendererHostsIn(text: string, file = "x.ts"): ts.NewExpression[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: ts.NewExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isNewExpression(n)) {
      const e = n.expression;
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
      if (name !== null && RENDERER_HOSTS.has(name)) found.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

test("every window in src/ is built with secureWebPreferences and overrides no hardening key", () => {
  const seen: string[] = [];
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8");
    // An alias would hide a constructor from the check below.
    assert.doesNotMatch(text, /\b(BrowserWindow|BrowserView|WebContentsView)\s+as\b/, `${file}: an aliased import`);
    for (const call of rendererHostsIn(text, file)) {
      seen.push(file);
      assert.deepEqual(problemsOf(call), [], `${file}: ${call.getText().slice(0, 120)}`);
    }
  }
  // The presenter (main.ts) and the room window (room/room-window.ts): the check is not vacuous.
  assert.ok(seen.some((f) => f.endsWith(join("main", "main.ts"))) && seen.some((f) => f.endsWith(join("room", "room-window.ts"))), seen.join(", "));
});

test("the check refuses each way of loosening a window", () => {
  const bad: Record<string, string> = {
    "no webPreferences": "new BrowserWindow({ show: false })",
    "hand-written preferences": "new BrowserWindow({ webPreferences: { preload: p, contextIsolation: true, sandbox: true } })",
    "an override of sandbox": "new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), sandbox: false } })",
    "an override of nodeIntegration": "new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), nodeIntegration: true } })",
    "an override in quotes": 'new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), "webSecurity": false } })',
    "the spread not first": "new BrowserWindow({ webPreferences: { contextIsolation: false, ...secureWebPreferences(p) } })",
    "a second spread": "new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), ...loose } })",
    "a computed key": "new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), [k]: false } })",
    "a spread after webPreferences": "new BrowserWindow({ webPreferences: secureWebPreferences(p), ...other })",
    "webPreferences twice": "new BrowserWindow({ webPreferences: secureWebPreferences(p), webPreferences: {} })",
    "options from a variable": "new BrowserWindow(opts)",
    "no options": "new BrowserWindow()",
    "a view": "new WebContentsView({ webPreferences: { nodeIntegration: true } })",
    "through the module": "new electron.BrowserWindow({ show: true })",
  };
  for (const [what, code] of Object.entries(bad)) {
    const calls = rendererHostsIn(code);
    assert.equal(calls.length, 1, what);
    assert.notDeepEqual(problemsOf(calls[0]!), [], what);
  }
  const good = ["new BrowserWindow({ ...bounds, show: false, webPreferences: secureWebPreferences(p) })", "new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), backgroundThrottling: false } })"];
  for (const code of good) assert.deepEqual(problemsOf(rendererHostsIn(code)[0]!), [], code);
});
