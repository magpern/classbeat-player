// The shell's guards are set only in src/main/hardening.ts and nothing removes them (#151 review,
// N3, N5, N6), checked on the syntax tree of every source in src/ by shell-guard-check.ts.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkShellGuards, REMOVAL, RESERVED } from "./shell-guard-check.ts";
import { checkSource } from "./window-prefs-check.ts";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const HARDENING = join(SRC, "main", "hardening.ts");
const OTHER = join(SRC, "main", "extra.ts");
const SCRIPT = /\.(c|m)?[jt]sx?$/;
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : SCRIPT.test(e.name) ? [join(dir, e.name)] : []));
const problems = (code: string, hardening = false): string[] => checkShellGuards(code, hardening ? HARDENING : OTHER, hardening).problems;

test("no source in src/ sets a guard outside hardening.ts or removes a listener", () => {
  for (const file of sources(SRC)) assert.deepEqual(checkShellGuards(readFileSync(file, "utf8"), file, file === HARDENING).problems, [], file);
  // hardening.ts is where they are set: the check is not vacuous.
  const own = checkShellGuards(readFileSync(HARDENING, "utf8"), HARDENING, true).reserved;
  for (const name of ["setWindowOpenHandler", "webRequest", "setPermissionRequestHandler", "setPermissionCheckHandler", "setDevicePermissionHandler", "setSpellCheckerEnabled"]) assert.ok(own.includes(name), name);
});

test("the window-open handler is set only in hardening.ts (N3)", () => {
  const bad = [
    'contents.setWindowOpenHandler(() => ({ action: "allow" }));',
    "presenter.webContents.setWindowOpenHandler(allow);",
    "presenter.webContents?.setWindowOpenHandler(allow);",
    'contents["setWindowOpenHandler"](allow);',
    "const { setWindowOpenHandler } = contents; setWindowOpenHandler.call(contents, allow);",
    "const { setWindowOpenHandler: s } = contents; s(allow);",
    "const set = contents.setWindowOpenHandler.bind(contents);",
    'import { setWindowOpenHandler } from "./x.ts";',
    'export { setWindowOpenHandler } from "./x.ts";',
    "const k = `setWindowOpenHandler`; void k;",
  ];
  for (const code of bad) assert.notDeepEqual(problems(code), [], code);
  assert.deepEqual(problems('contents.setWindowOpenHandler(() => ({ action: "deny" }));', true), []);
  // A name built from strings is refused by the window check, which reads every file too.
  const built = 'contents["setWindow" + "OpenHandler"](allow);';
  assert.deepEqual(problems(built), []);
  assert.match(checkSource(built, OTHER).problems.join("\n"), /a member name built from strings/);
});

test("nothing removes a listener, in hardening.ts or elsewhere (N5)", () => {
  const bad = [
    'app.removeAllListeners("web-contents-created");',
    "app.removeAllListeners();",
    'app.off("web-contents-created", guard);',
    'app.removeListener("web-contents-created", guard);',
    'contents.off("will-navigate", refuse);',
    'app["removeAllListeners"]("web-contents-created");',
    "const { removeAllListeners } = app; removeAllListeners.call(app);",
    "EventEmitter.prototype.removeAllListeners.call(app);",
    'const k = "off"; void k;',
  ];
  for (const code of bad) {
    assert.notDeepEqual(problems(code), [], code);
    assert.notDeepEqual(problems(code, true), [], `${code} (hardening.ts)`);
  }
});

test("session handlers, protocols, preloads and the spell checker are set only in hardening.ts (N6)", () => {
  const bad = [
    "ses.setPermissionRequestHandler((_w, _p, cb) => cb(true));",
    "session.defaultSession.setPermissionCheckHandler(() => true);",
    "ses.setDevicePermissionHandler(() => true);",
    "ses.setDisplayMediaRequestHandler(h);",
    "ses.setCertificateVerifyProc((_r, cb) => cb(0));",
    "ses.webRequest.onBeforeRequest((_d, cb) => cb({}));",
    "const { webRequest } = ses; webRequest.onHeadersReceived(h);",
    'import { protocol } from "electron";\nprotocol.handle("app", h);',
    'ses.protocol.handle("app", h);',
    "const p = ses.protocol; void p;",
    "const { protocol } = ses; void protocol;",
    'ses["protocol"].handle("app", h);',
    "ses.registerPreloadScript({ type: 'frame', filePath: f });",
    "ses.setPreloads([f]);",
    "ses.setSpellCheckerEnabled(true);",
    "ses.setSpellCheckerDictionaryDownloadURL(u);",
    // Only a comparison makes reading `protocol` harmless (#154 review, N-1).
    'const p = (ses.protocol || x); p.handle("app", h);',
    'const p = (ses.protocol ?? x); p.handle("app", h);',
    "const p = ses.protocol && x; void p;",
    "if (ses.protocol) void 0;",
  ];
  for (const code of bad) assert.notDeepEqual(problems(code), [], code);
  for (const code of bad) assert.deepEqual(problems(code, true), [], `${code} (hardening.ts)`);
});

test("the names stay usable where they set nothing", () => {
  const fine = [
    'const secure = url.protocol === "https:" || (url.protocol === "http:" && loopback);',
    'if (u?.protocol !== "file:") throw new Error("x");',
    "const off = (): void => undefined; off(); const timers = [off];",
    "type H = Parameters<Session['setPermissionRequestHandler']>[0]; type O = typeof app.off;",
    "type F = { off: boolean; protocol: number }; const flags: F = JSON.parse(t) as F; void flags;",
    "const [off] = pair; void off;",
    "interface X { removeListener(): void; webRequest: unknown }",
  ];
  for (const code of fine) assert.deepEqual(problems(code), [], code);
  assert.ok([...RESERVED].every((n) => !REMOVAL.has(n)));
});

// An object literal or class carrying a guarded name can be copied onto a contents or the app
// (#154 review, N-4): such keys are refused, outside hardening.ts for a reserved name, everywhere for
// a removal.
test("a guarded name is never the key of an object literal or a class", () => {
  const reserved = [
    "Object.assign(Object.getPrototypeOf(contents), { setWindowOpenHandler: noop });",
    "Object.assign(proto, { setWindowOpenHandler() {} });",
    "const setWindowOpenHandler = noop; Object.assign(proto, { setWindowOpenHandler });",
    "Object.assign(proto, { get webRequest() { return fake; } });",
    "Object.assign(ses, { protocol: fake });",
    "const setPermissionCheckHandler = 1; Object.assign(ses, { [setPermissionCheckHandler]: noop });",
    'Object.assign(proto, { ["setWindowOpenHandler"]: noop });',
    "Object.assign(proto, { [`setWindowOpenHandler`]: noop });",
    "class Fake { setWindowOpenHandler = noop; } Object.assign(proto, new Fake());",
    "class Fake { setSpellCheckerEnabled(): void {} }",
  ];
  for (const code of reserved) {
    assert.notDeepEqual(problems(code), [], code);
    assert.deepEqual(problems(code, true).filter((p) => !/a string/.test(p)), [], `${code} (hardening.ts)`);
  }
  const removal = [
    "Object.assign(app, { removeAllListeners: noop });",
    "const off = noop; Object.assign(app, { off });",
    "Object.assign(contents, { removeListener() {} });",
    "class C { off(): void {} }",
  ];
  for (const code of removal) {
    assert.notDeepEqual(problems(code), [], code);
    assert.notDeepEqual(problems(code, true), [], `${code} (hardening.ts)`);
  }
  // A key built from strings names nothing the checker can read, so it is refused too.
  for (const code of ['Object.assign(proto, { ["setWindow" + "OpenHandler"]: noop });', "Object.assign(proto, { [`set${x}`]: noop });"]) {
    assert.match(problems(code).join("\n"), /a key built from strings/, code);
  }
  // Interface and type keys define no value.
  assert.deepEqual(problems("interface I { setWindowOpenHandler(h: H): void; off: number } type T = { protocol: string };"), []);
});
