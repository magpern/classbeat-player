// The locked shell's web-side configuration (issue #627): the page's Content Security Policy is the
// desktop room screen's, and the Capacitor config the app ships opens nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ROOM_CSP } from "../../app/src/main/web-preferences.ts";
import { MOBILE_CSP, PAGES, pageHtml } from "../src/page.ts";
import type { PageName } from "../src/page.ts";

const NAMES = Object.keys(PAGES) as PageName[];

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "android", "app", "src", "main", "assets");
const json = (name: string): unknown => JSON.parse(readFileSync(join(ASSETS, name), "utf8"));

test("every page's CSP is the desktop room screen's, word for word", () => {
  assert.equal(MOBILE_CSP, ROOM_CSP);
  for (const name of NAMES) {
    const metas = [...pageHtml(name).matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)].map((m) => m[1]);
    assert.deepEqual(metas, [ROOM_CSP], name);
  }
  assert.doesNotMatch(ROOM_CSP, /"/, "the policy fits in a double-quoted attribute");
});

test("each page loads only its own mode's bundle, and index.html loads nothing", () => {
  // The pages of ModePolicy.kt: rider.html in rider mode; instructor.html and room.html in instructor mode.
  const expected: Record<PageName, string[]> = {
    "index.html": [],
    "rider.html": ["rider.css", "rider.js"],
    "instructor.html": ["instructor.css", "instructor.js"],
    "room.html": ["main.css", "main.js"],
  };
  assert.deepEqual(NAMES.sort(), Object.keys(expected).sort());
  for (const name of NAMES) {
    const html = pageHtml(name);
    const refs = [...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(refs, expected[name], name);
    assert.doesNotMatch(html, /:\/\//, name);
  }
});

type Config = {
  server?: Record<string, unknown>;
  android?: Record<string, unknown>;
  plugins?: Record<string, { enabled?: unknown }>;
  [k: string]: unknown;
};
const config = json("capacitor.config.json") as Config;

test("the Capacitor config opens no server, navigation or cleartext", () => {
  const server = config.server ?? {};
  assert.deepEqual(Object.keys(server).sort(), ["androidScheme", "cleartext", "hostname"]);
  assert.equal(server.androidScheme, "https");
  assert.equal(server.hostname, "localhost");
  assert.equal(server.cleartext, false);
  for (const k of ["url", "allowNavigation", "errorPath", "appStartPath"]) assert.equal(server[k], undefined, k);
});

test("the Android options allow no mixed content, no debugging and no service-worker requests", () => {
  const android = config.android ?? {};
  assert.equal(android.allowMixedContent, false);
  assert.equal(android.resolveServiceWorkerRequests, false);
  // Web view debugging follows the build type in MainActivity, never this file.
  assert.equal(android.webContentsDebuggingEnabled, undefined);
  assert.equal(config.webContentsDebuggingEnabled, undefined);
  assert.equal(android.useLegacyBridge, undefined);
});

test("the cookie and HTTP plugins are switched off and no plugin is shipped", () => {
  assert.deepEqual(config.plugins, { CapacitorCookies: { enabled: false }, CapacitorHttp: { enabled: false } });
  assert.deepEqual(json("capacitor.plugins.json"), []);
});
