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

// Every script, JavaScript too (N7): the checker reads them all the same way.
const SCRIPT = /\.(c|m)?[jt]sx?$/;
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : SCRIPT.test(e.name) ? [join(dir, e.name)] : []));
}

test("the scan takes in every script under src/, JavaScript included", () => {
  const all = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(dir, e.name)) : [join(dir, e.name)]));
  // Anything else under src/ is a kind of file that runs in no process that can make a window.
  const rest = all(SRC).filter((f) => !sources(SRC).includes(f));
  assert.deepEqual(rest.filter((f) => !/\.(css|html|txt|woff2)$/.test(f)), []);
  for (const name of ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"]) assert.match(name, SCRIPT, name);
  // A window in a .js, .cjs or .mjs file is refused like one in TypeScript.
  for (const ext of ["js", "cjs", "mjs"]) assert.notDeepEqual(checkSource('import { BrowserWindow } from "electron";\nnew BrowserWindow({});', join(SRC, "main", `x.${ext}`)).problems, [], ext);
});

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
    "a window's constructor (review 2)": ["const C = BrowserWindow.getAllWindows()[0]!.constructor as typeof BrowserWindow; new C({ webPreferences: { sandbox: false } });"],
    "the presenter's constructor, new on the member": ["new (presenter.constructor as typeof BrowserWindow)({ webPreferences: { sandbox: false } });"],
    "constructor by string": ['const C = presenter["constructor"]; new C({});'],
    "constructor built from a template": ["const k = `con${s}`; const C = presenter[`${k}structor`]; new C({});"],
    "constructor built with plus": ['const C = presenter["con" + "structor"]; new C({});'],
    "import = require (review 2)": ['import electron = require("electron");\nconst w = "Window"; new electron[`Browser${w}`]({});'],
    "import = require alone": ['import e = require("electron");\nvoid e;'],
    "a member built from a template": ["const W = electron[`Browser${w}`]; void W;"],
    "Reflect.construct on a value": ["Reflect.construct(win.constructor, [{}]);"],
    "new of a local value": ["const C = pick(); new C({});"],
    "new of a call": ["new (pick())({});"],
    "new of a member": ["new things.Win({});"],
    "new of a parameter": ["const f = (C: typeof BrowserWindow) => new C({});"],
    "a global shadowed": ["const Map = pick(); new Map({});"],
    "an aliased import as callee": ['import { Thing as Map } from "./x.ts";\nnew Map({});'],
    "a parameter secureWebPreferences": ["const f = (secureWebPreferences: (p: string) => object) => new BrowserWindow({ webPreferences: secureWebPreferences(p) });"],
  };
  for (const [what, [code]] of Object.entries(bad)) assert.notDeepEqual(ok(code), [], what);
  // The two routes of the second review are refused by the rules made for them, not by chance.
  const said = (code: string): string => ok(code).join("\n");
  assert.match(said("const C = presenter.constructor; new C({ webPreferences: {} });"), /: constructor$/m);
  assert.match(said("const C = presenter.constructor; new C({ webPreferences: {} });"), /a new of C, not an import/);
  assert.match(said('import electron = require("electron");\nconst w = "Window"; new electron[`Browser${w}`]({});'), /an import = require/);
  assert.match(said('import electron = require("electron");\nconst w = "Window"; new electron[`Browser${w}`]({});'), /a member name built from strings/);
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
  assert.deepEqual(ok('new Map(); new Set([1]); new Intl.Collator("sv"); new URL("file:///x"); new Error("e");'), [], "built-in constructors");
  assert.deepEqual(ok('import { Menu } from "electron";\nclass Own {}\nnew Menu(); new Own(); const k = `a${1}`; rows[i + 1];'), [], "imports, own classes, templates, arithmetic keys");
  assert.deepEqual(checkSource('import { BrowserWindow } from "electron";\nimport { secureWebPreferences } from "../web-preferences.ts";\nnew BrowserWindow({ webPreferences: secureWebPreferences(p) });', ROOM).problems, []);
});
