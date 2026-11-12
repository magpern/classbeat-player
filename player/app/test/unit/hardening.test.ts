// The shell's hardening settings, checked without Electron (the e2e test checks the live windows).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CSP, isAllowedRequest, secureWebPreferences } from "../../src/main/web-preferences.ts";
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

test("CSP: nothing by default, scripts only from the app, no network, no media", () => {
  const d = new Map(CSP.split("; ").map((x) => [x.split(" ")[0], x.split(" ").slice(1).join(" ")]));
  assert.equal(d.get("default-src"), "'none'");
  assert.equal(d.get("script-src"), "'self'");
  for (const k of ["connect-src", "media-src", "object-src", "frame-src", "worker-src", "base-uri", "form-action"]) {
    assert.equal(d.get(k), "'none'", k);
  }
  assert.doesNotMatch(CSP, /unsafe-inline|unsafe-eval|https?:|data:|blob:|\*/);
});

test("presenter.html carries exactly that CSP, before any script", () => {
  const html = readFileSync(join(APP, "src", "renderer", "presenter.html"), "utf8");
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(m, "CSP meta tag missing");
  assert.equal(m[1], CSP);
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"));
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/, "inline script");
  assert.doesNotMatch(html, /\son[a-z]+=/i, "inline event handler");
});

test("requests: only the application's own files", () => {
  const dir = "file:///opt/app/dist/";
  assert.equal(isAllowedRequest("file:///opt/app/dist/presenter.js", dir), true);
  for (const url of ["https://example.invalid/", "http://127.0.0.1/", "ws://x/", "file:///etc/passwd", "file:///opt/app/distx/a.js", "data:text/html,x", "devtools://devtools/x"]) {
    assert.equal(isAllowedRequest(url, dir), false, url);
  }
});
