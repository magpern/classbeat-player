// Every renderer the shell creates has the hardening of web-preferences.ts (#149, N4), checked on
// the syntax tree of every source in src/ by window-prefs-check.ts (allowlists, see there).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkSource, EXTRA_KEYS } from "./window-prefs-check.ts";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const ROOM = join(SRC, "main", "room", "room-window.ts");
const MAIN = join(SRC, "main", "main.ts");
const EXTRA = join(SRC, "main", "extra-window.ts");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.(c|m)?tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}

test("every window in src/ is built with secureWebPreferences and only allowed extra keys", () => {
  const seen: string[] = [];
  for (const file of sources(SRC)) {
    const r = checkSource(readFileSync(file, "utf8"), file);
    assert.deepEqual(r.problems, [], file);
    if (r.windows > 0) seen.push(file);
  }
  // The presenter and the room window: the check is not vacuous.
  assert.deepEqual(seen.sort(), [MAIN, ROOM].sort());
  assert.deepEqual([...EXTRA_KEYS], ["backgroundThrottling"], "a new extra key is a security review of its own");
});

const IMPORTS = 'import { BrowserWindow } from "electron";\nimport { secureWebPreferences } from "./web-preferences.ts";\n';
const ok = (code: string, file = EXTRA): string[] => checkSource(IMPORTS + code, file).problems;

test("the check refuses each way of loosening a window", () => {
  const bad: Record<string, [string, string?]> = {
    "no webPreferences": ["new BrowserWindow({ show: false });"],
    "hand-written preferences": ["new BrowserWindow({ webPreferences: { preload: p, contextIsolation: true, sandbox: true } });"],
    "an override of sandbox": ["new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), sandbox: false } });"],
    "an override in quotes": ['new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), "webSecurity": false } });'],
    "another session: partition": ['new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), backgroundThrottling: false, partition: "room" } });'],
    "another session: session": ["new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), session: s } });"],
    "the spread not first": ["new BrowserWindow({ webPreferences: { contextIsolation: false, ...secureWebPreferences(p) } });"],
    "a second spread": ["new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), ...loose } });"],
    "a computed inner key": ["new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), [k]: false } });"],
    "a spread after webPreferences": ["new BrowserWindow({ webPreferences: secureWebPreferences(p), ...other });"],
    "webPreferences twice": ["new BrowserWindow({ webPreferences: secureWebPreferences(p), webPreferences: {} });"],
    "a computed outer webPreferences": ['new BrowserWindow({ webPreferences: secureWebPreferences(p), ["webPreferences"]: { sandbox: false } });'],
    "an outer key in quotes": ['new BrowserWindow({ "webPreferences": { sandbox: false } });'],
    "a getter": ["new BrowserWindow({ get webPreferences() { return {}; } });"],
    "shorthand webPreferences": ["const webPreferences = {}; new BrowserWindow({ webPreferences });"],
    "options from a variable": ["new BrowserWindow(opts);"],
    "no options": ["new BrowserWindow();"],
    "a view": ["new WebContentsView({ webPreferences: { nodeIntegration: true } });"],
    "the constructor in a variable": ["const Win = BrowserWindow; new Win({ webPreferences: { sandbox: false } });"],
    "the constructor passed on": ["Reflect.construct(BrowserWindow, [{}]);"],
    "a static member other than a finder": ["const W = BrowserWindow.prototype.constructor; new W({});"],
    "a finder not called": ["const find = BrowserWindow.getFocusedWindow; void find;"],
    "a subclass": ["class Win extends BrowserWindow {} new Win({});"],
    "require with destructuring": ['const { BrowserWindow: Win } = require("electron"); new Win({});'],
    "require of electron": ['const e = require("electron"); new e.BrowserWindow({});'],
    "a dynamic import": ['void import("electron").then((e) => new e.BrowserWindow({}));'],
    "member access by string": ['new electron["BrowserWindow"]({});'],
    "an aliased import": ['import { BrowserWindow as Win } from "electron"; new Win({});'],
    "a namespace import": ['import * as electron from "electron"; new electron.BrowserWindow({});'],
    "a default import": ['import electron from "electron"; new electron.BrowserWindow({});'],
    "a local secureWebPreferences": ["const secureWebPreferences = (p: string) => ({ preload: p, sandbox: false }); new BrowserWindow({ webPreferences: secureWebPreferences(p) });"],
    "a function secureWebPreferences": ["function secureWebPreferences(p: string) { return { preload: p }; } new BrowserWindow({ webPreferences: secureWebPreferences(p) });"],
    "a parameter secureWebPreferences": ["const f = (secureWebPreferences: (p: string) => object) => new BrowserWindow({ webPreferences: secureWebPreferences(p) });"],
  };
  for (const [what, [code]] of Object.entries(bad)) assert.notDeepEqual(ok(code), [], what);
  // An import of another function under the name, or of the real one from elsewhere or renamed.
  const imports: Record<string, string> = {
    "renamed into the name": 'import { BrowserWindow } from "electron";\nimport { loose as secureWebPreferences } from "./web-preferences.ts";\n',
    "the real one renamed": 'import { BrowserWindow } from "electron";\nimport { secureWebPreferences as s } from "./web-preferences.ts";\n',
    "from another module": 'import { BrowserWindow } from "electron";\nimport { secureWebPreferences } from "./loose-preferences.ts";\n',
    "not imported": 'import { BrowserWindow } from "electron";\n',
  };
  for (const [what, head] of Object.entries(imports)) {
    assert.notDeepEqual(checkSource(`${head}new BrowserWindow({ webPreferences: secureWebPreferences(p) });`, EXTRA).problems, [], what);
  }
});

test("the check accepts the windows as the shell writes them", () => {
  assert.deepEqual(ok("new BrowserWindow({ ...bounds, show: false, webPreferences: secureWebPreferences(p) });"), []);
  assert.deepEqual(ok("new BrowserWindow({ webPreferences: { ...secureWebPreferences(p), backgroundThrottling: false } });"), []);
  assert.deepEqual(ok("let w: BrowserWindow | null = null; const f = (x: typeof BrowserWindow): void => void x;"), [], "types");
  assert.deepEqual(ok("BrowserWindow.getFocusedWindow()?.focus(); BrowserWindow.getAllWindows();"), [], "finding windows");
  assert.deepEqual(checkSource('import { BrowserWindow } from "electron";\nimport { secureWebPreferences } from "../web-preferences.ts";\nnew BrowserWindow({ webPreferences: secureWebPreferences(p) });', ROOM).problems, []);
});
