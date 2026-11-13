// The runtime guard's read of a live renderer (loose-renderer.ts): anything it cannot read, a
// throwing getter included, is loose, so hardening.ts closes the renderer (#154 review, N-2).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { looseRenderer, UNREADABLE } from "../../src/main/loose-renderer.ts";
import type { LiveRenderer } from "../../src/main/loose-renderer.ts";
import { REPORTED_KEYS, secureWebPreferences } from "../../src/main/web-preferences.ts";
import { REPO } from "./fixtures.ts";

const PRELOAD = "/app/dist/preload.cjs";
const want = secureWebPreferences(PRELOAD) as unknown as Record<string, unknown>;
const REPORTED = Object.fromEntries(REPORTED_KEYS.map((k) => [k, want[k]]));
const SESSION = { getPreloadScripts: (): unknown[] => [], isSpellCheckerEnabled: (): boolean => false };

function fake(over: Partial<Record<"session" | "getLastWebPreferences" | "_getPreloadScript", unknown>> = {}): LiveRenderer {
  const base: Record<string, unknown> = {
    session: SESSION,
    getLastWebPreferences: () => REPORTED,
    _getPreloadScript: () => ({ type: "frame", filePath: PRELOAD }),
  };
  for (const [k, v] of Object.entries(over)) Object.defineProperty(base, k, typeof v === "function" && k === "session" ? { get: v as () => unknown } : { value: v });
  return base as unknown as LiveRenderer;
}
const boom = (): never => {
  throw new Error("internal changed");
};
const check = (r: LiveRenderer, ses: () => unknown = () => SESSION): string[] => looseRenderer(r, ses, [PRELOAD]);

test("a hardened renderer on the default session is not loose (control)", () => {
  assert.deepEqual(check(fake()), []);
});

test("the read still finds what is loose", () => {
  assert.deepEqual(check(fake({ getLastWebPreferences: () => ({ ...REPORTED, sandbox: false }) })), ["sandbox"]);
  assert.deepEqual(check(fake(), () => ({})), ["session"]);
  assert.deepEqual(check(fake({ _getPreloadScript: undefined })), ["preload"]);
});

test("a getter that throws makes the renderer loose, whichever it is", () => {
  const throwingSession = (name: "getPreloadScripts" | "isSpellCheckerEnabled"): unknown => () => ({ ...SESSION, [name]: boom });
  const cases: Record<string, [LiveRenderer, (() => unknown)?]> = {
    getLastWebPreferences: [fake({ getLastWebPreferences: boom })],
    _getPreloadScript: [fake({ _getPreloadScript: boom })],
    session: [fake({ session: boom })],
    getPreloadScripts: [fake({ session: throwingSession("getPreloadScripts") })],
    isSpellCheckerEnabled: [fake({ session: throwingSession("isSpellCheckerEnabled") })],
    defaultSession: [fake(), boom],
  };
  for (const [name, [r, ses]] of Object.entries(cases)) assert.deepEqual(check(r, ses), [UNREADABLE], name);
});

test("an odd answer is loose too, never a pass", () => {
  assert.notDeepEqual(check(fake({ getLastWebPreferences: () => undefined })), []);
  assert.notDeepEqual(check(fake({ session: () => ({ ...SESSION, getPreloadScripts: () => null }) })), []);
  assert.notDeepEqual(check(fake({ session: () => ({ ...SESSION, isSpellCheckerEnabled: () => undefined }) })), []);
});

test("hardening.ts refuses through looseRenderer, at creation and on every load", () => {
  const src = readFileSync(join(REPO, "player", "app", "src", "main", "hardening.ts"), "utf8");
  assert.match(src, /const loose = looseRenderer\(contents as unknown as LiveRenderer, \(\) => session\.defaultSession, preloads\);/);
  assert.match(src, /if \(loose\.length === 0\) return;[\s\S]*contents\.close\(\);/);
  assert.match(src, /refuseLoose\(contents, preloads\);\n\s*contents\.on\("did-start-navigation", \(\) => refuseLoose\(contents, preloads\)\);/);
});
