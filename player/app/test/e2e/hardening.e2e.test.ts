// The live windows are hardened: web preferences, CSP, no navigation, no new windows, no remote
// content, no permissions, and IPC from any other window is refused.
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { CSP } from "../../src/main/web-preferences.ts";
import { APP_DIR, launch, sleep } from "./launch.ts";

let app: ElectronApplication;
let page: Page;

before(async () => {
  ({ app, page } = await launch());
});
after(async () => {
  await app?.close();
});

test("web preferences of the live window", async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => {
      // getLastWebPreferences is Electron's own record of what the window runs with (not in its typings).
      const wc = w.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> | null };
      const p = wc.getLastWebPreferences() ?? {};
      return { ci: p.contextIsolation, ni: p.nodeIntegration, sb: p.sandbox, wv: p.webviewTag, ws: p.webSecurity };
    }),
  );
  assert.equal(prefs.length, 1);
  assert.deepEqual(prefs[0], { ci: true, ni: false, sb: true, wv: false, ws: true });
});

test("the page has no Node and only the narrow preload API", async () => {
  const r = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>).require,
    process: typeof (globalThis as Record<string, unknown>).process,
    api: Object.keys((window as unknown as { player: object }).player).sort(),
  }));
  assert.deepEqual(r, { require: "undefined", process: "undefined", api: ["command", "getState", "onUpdate", "openDropped"] });
});

test("CSP is present and blocks inline scripts and network requests", async () => {
  const meta = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"));
  assert.equal(meta, CSP);
  const inline = await page.evaluate(async () => {
    const s = document.createElement("script");
    s.textContent = "window.__inline = 1";
    document.head.append(s);
    await new Promise((r) => setTimeout(r, 100));
    return (window as unknown as { __inline?: number }).__inline ?? null;
  });
  assert.equal(inline, null);
  const fetched = await page.evaluate(async () => {
    try {
      await fetch("https://example.invalid/");
      return "fetched";
    } catch {
      return "blocked";
    }
  });
  assert.equal(fetched, "blocked");
});

test("navigation and new windows are denied", async () => {
  const url = page.url();
  assert.match(url, /^file:.*\/dist\/presenter\.html$/);
  // A URL inside dist/ is app content for loading resources, but the page may not navigate to it.
  const insideDist = pathToFileURL(join(APP_DIR, "dist", "presenter.js")).href;
  for (const target of ["https://example.invalid/", "file:///etc/hostname", insideDist]) {
    await page.evaluate((t) => {
      window.location.href = t;
    }, target);
    await sleep(500);
    assert.equal(page.url(), url, `navigated to ${target}`);
  }
  const opened = await page.evaluate(() => window.open("https://example.invalid/") === null);
  assert.equal(opened, true);
  assert.equal((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)), 1);
});

test("permission requests are denied", async () => {
  const r = await page.evaluate(async () => {
    const n = await Notification.requestPermission();
    let media = "granted";
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      media = "denied";
    }
    return { n, media };
  });
  assert.deepEqual(r, { n: "denied", media: "denied" });
});

test("IPC from the wrong window is refused and changes nothing", async () => {
  const before = await page.evaluate(() => (window as unknown as { player: { getState(): Promise<unknown> } }).player.getState());
  assert.notEqual(before, null);
  const preload = join(APP_DIR, "dist", "preload.cjs");
  const presenterFile = join(APP_DIR, "dist", "presenter.html");
  const r = await app.evaluate(
    async ({ BrowserWindow }, { preload, presenterFile }) => {
      // Same preload, same page: only the sender differs from the presenter.
      const w = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false } });
      await w.loadFile(presenterFile);
      // No named helper here: the test runner's transform would rename it out of scope.
      const wc = w.webContents;
      const out = {
        state: await wc.executeJavaScript("window.player.getState()"),
        command: await wc.executeJavaScript("window.player.command({ type: 'start' })"),
        open: await wc.executeJavaScript("window.player.openDropped('x.json', '{}')"),
      };
      w.destroy();
      return out;
    },
    { preload, presenterFile },
  );
  assert.deepEqual(r, { state: null, command: null, open: null });
  const afterState = await page.evaluate(() => (window as unknown as { player: { getState(): Promise<unknown> } }).player.getState());
  assert.deepEqual(afterState, before);
});

test("malformed IPC from the presenter itself is refused", async () => {
  const r = await page.evaluate(async () => {
    const p = (window as unknown as { player: { command(c: unknown): Promise<unknown> } }).player;
    return [await p.command({ type: "seek", ms: 0 }), await p.command({ type: "jump", deltaMs: 60000 }), await p.command("start")];
  });
  assert.deepEqual(r, [null, null, null]);
});
