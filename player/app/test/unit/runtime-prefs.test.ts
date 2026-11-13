// The runtime guard's comparison (web-preferences.ts, `looseKeys`; hardening.ts closes a renderer
// it finds loose): every hardening key Electron reports, value by value, and the session.
import assert from "node:assert/strict";
import { test } from "node:test";
import { looseKeys, REPORTED_KEYS, secureWebPreferences } from "../../src/main/web-preferences.ts";

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
