// The shell's hardening settings, checked without Electron (the e2e test checks the live windows).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CSP, LIST_CSP, ROOM_CSP, isAllowedRequest, secureWebPreferences } from "../../src/main/web-preferences.ts";
import { REPO } from "./fixtures.ts";

const APP = join(REPO, "player", "app");

test("web preferences: isolation, sandbox, no Node, no webview", () => {
  const p = secureWebPreferences("/x/preload.cjs");
  assert.equal(p.preload, "/x/preload.cjs");
  assert.equal(p.contextIsolation, true);
  assert.equal(p.sandbox, true);
  assert.equal(p.nodeIntegration, false);
  assert.equal(p.nodeIntegrationInWorker, false);
  assert.equal(p.nodeIntegrationInSubFrames, false);
  assert.equal(p.webSecurity, true);
  assert.equal(p.allowRunningInsecureContent, false);
  assert.equal(p.webviewTag, false);
  assert.equal(p.navigateOnDragDrop, false);
});

/** A policy as a map of directive to its sources. */
const directives = (csp: string): Map<string, string> =>
  new Map(csp.split("; ").map((x) => [x.split(" ")[0]!, x.split(" ").slice(1).join(" ")]));

// The presenter's whole policy, pinned as an allowlist: a directive added, dropped or widened fails
// here. Style comes only from the app's own presenter.css (#682); fonts stay off.
const PRESENTER_POLICY: readonly (readonly [string, string])[] = [
  ["default-src", "'none'"],
  ["script-src", "'self'"],
  ["style-src", "'self'"],
  ["img-src", "'none'"],
  ["font-src", "'none'"],
  ["connect-src", "'none'"],
  ["media-src", "'none'"],
  ["object-src", "'none'"],
  ["frame-src", "'none'"],
  ["worker-src", "'none'"],
  ["manifest-src", "'none'"],
  ["base-uri", "'none'"],
  ["form-action", "'none'"],
];

test("CSP: nothing by default, scripts and style only from the app, no font, no network, no media", () => {
  assert.deepEqual([...directives(CSP)], PRESENTER_POLICY);
  assert.doesNotMatch(CSP, /unsafe-|nonce-|sha\d+-|https?:|data:|blob:|filesystem:|\*/);
});

test("the class list's and room's policy is the presenter's with the app's own fonts, nothing else", () => {
  const list = PRESENTER_POLICY.map(([k, v]) => [k, k === "font-src" ? "'self'" : v]);
  assert.deepEqual([...directives(LIST_CSP)], list);
  assert.equal(ROOM_CSP, LIST_CSP);
});

test("presenter.html carries exactly that CSP, before any script", () => {
  const html = readFileSync(join(APP, "src", "renderer", "presenter.html"), "utf8");
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(m, "CSP meta tag missing");
  assert.equal(m[1], CSP);
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"));
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/, "inline script");
  assert.doesNotMatch(html, /\son[a-z]+=/i, "inline event handler");
  assert.doesNotMatch(html, /<style|\sstyle=/i, "inline style");
  const sheets = [...html.matchAll(/<link\b[^>]*>/g)].map((x) => x[0]);
  assert.deepEqual(sheets, ['<link rel="stylesheet" href="presenter.css">'], "one bundled style sheet");
});

test("production enables Chromium's sandbox unless the test-only --no-sandbox switch is present", () => {
  const main = readFileSync(join(APP, "src", "main", "main.ts"), "utf8");
  const hardening = readFileSync(join(APP, "src", "main", "hardening.ts"), "utf8");
  assert.match(hardening, /if \(!app\.commandLine\.hasSwitch\("no-sandbox"\)\) app\.enableSandbox\(\);/);
  const call = main.indexOf("enableSandboxUnlessTest();");
  assert.ok(call > 0, "main.ts does not call it");
  assert.ok(call < main.indexOf("app.whenReady"), "it must run before the app is ready");
  assert.doesNotMatch(main + hardening, /commandLine\.appendSwitch\(["']no-sandbox/, "the app never turns the sandbox off itself");
});

test("requests: only the application's own files", () => {
  const dir = "file:///opt/app/dist/";
  assert.equal(isAllowedRequest("file:///opt/app/dist/presenter.js", dir), true);
  for (const url of ["https://example.invalid/", "http://127.0.0.1/", "ws://x/", "file:///etc/passwd", "file:///opt/app/distx/a.js", "data:text/html,x", "devtools://devtools/x"]) {
    assert.equal(isAllowedRequest(url, dir), false, url);
  }
});
