// The runtime guard's comparison (web-preferences.ts, `looseKeys`; hardening.ts closes a renderer
// it finds loose): every hardening key Electron reports, value by value, and the session.
import assert from "node:assert/strict";
import { test } from "node:test";
import { looseExtras, looseKeys, REPORTED_KEYS, secureWebPreferences } from "../../src/main/web-preferences.ts";

// What Electron reports for the presenter (getLastWebPreferences), the keys it adds included.
const HARDENED: Record<string, unknown> = {
  allowRunningInsecureContent: false,
  contextIsolation: true,
  disableDialogs: false,
  disablePopups: false,
  enableBlinkFeatures: "",
  experimentalFeatures: false,
  javascript: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  safeDialogs: true,
  safeDialogsMessage: "",
  sandbox: true,
  webSecurity: true,
  webviewTag: false,
};

test("the hardened renderer is not loose, extra keys and Electron's own keys aside", () => {
  assert.deepEqual(looseKeys(HARDENED, true), []);
  assert.deepEqual(looseKeys({ ...HARDENED, backgroundThrottling: false }, true), []);
});

test("every reported hardening key is compared, value by value", () => {
  const secure = secureWebPreferences("") as unknown as Record<string, unknown>;
  for (const k of REPORTED_KEYS) {
    const other = typeof secure[k] === "boolean" ? !secure[k] : "CSSPaintAPI";
    assert.deepEqual(looseKeys({ ...HARDENED, [k]: other }, true), [k], k);
    const missing = { ...HARDENED };
    delete missing[k];
    assert.deepEqual(looseKeys(missing, true), [k], `${k} missing`);
  }
  assert.deepEqual(looseKeys({ ...HARDENED, sandbox: false, nodeIntegration: true }, true), ["sandbox", "nodeIntegration"]);
  // A truthy stand-in is not the value.
  assert.deepEqual(looseKeys({ ...HARDENED, sandbox: 1 }, true), ["sandbox"]);
});

test("another session, or nothing reported, is loose", () => {
  assert.deepEqual(looseKeys(HARDENED, false), ["session"]);
  assert.deepEqual(looseKeys(null, true), ["webPreferences"]);
});

test("the reported keys are every hardening key but the three Electron does not report", () => {
  const all = Object.keys(secureWebPreferences("x")).sort();
  const unreported = all.filter((k) => !(REPORTED_KEYS as readonly string[]).includes(k));
  assert.deepEqual(unreported, ["navigateOnDragDrop", "preload", "spellcheck"]);
  const reported = Object.keys(HARDENED).filter((k) => (REPORTED_KEYS as readonly string[]).includes(k));
  assert.deepEqual(reported.sort(), [...REPORTED_KEYS].sort(), "Electron reports them all");
});

// The three keys Electron does not report (N2): the preload and the spell checker read another way.
const ALLOWED = ["/app/dist/preload.cjs", "/app/dist/room-preload.cjs"];
const CLEAN = { preload: { filePath: "/app/dist/preload.cjs", id: "", type: "frame" }, sessionPreloads: 0, spellChecker: false };

test("an allowed preload, no session preloads and the spell checker off are not loose", () => {
  assert.deepEqual(looseExtras(CLEAN, ALLOWED), []);
  assert.deepEqual(looseExtras({ ...CLEAN, preload: { ...CLEAN.preload, filePath: "/app/dist/room-preload.cjs" } }, ALLOWED), []);
});

test("another preload, none, or one Electron cannot say is loose", () => {
  const preloads: Record<string, unknown> = {
    another: { filePath: "/tmp/evil.cjs", id: "", type: "frame" },
    "the same file by another path": { filePath: "/app/dist/../dist/preload.cjs", id: "", type: "frame" },
    "not a frame preload": { filePath: "/app/dist/preload.cjs", id: "", type: "service-worker" },
    "no path": { id: "", type: "frame" },
    none: null,
    "cannot say": undefined,
    "a bare string": "/app/dist/preload.cjs",
  };
  for (const [what, preload] of Object.entries(preloads)) assert.deepEqual(looseExtras({ ...CLEAN, preload }, ALLOWED), ["preload"], what);
  assert.deepEqual(looseExtras(CLEAN, []), ["preload"], "nothing allowed");
});

test("a session preload or the spell checker on is loose", () => {
  assert.deepEqual(looseExtras({ ...CLEAN, sessionPreloads: 1 }, ALLOWED), ["sessionPreloads"]);
  assert.deepEqual(looseExtras({ ...CLEAN, spellChecker: true }, ALLOWED), ["spellcheck"]);
  assert.deepEqual(looseExtras({ preload: null, sessionPreloads: 2, spellChecker: true }, ALLOWED), ["preload", "sessionPreloads", "spellcheck"]);
});
