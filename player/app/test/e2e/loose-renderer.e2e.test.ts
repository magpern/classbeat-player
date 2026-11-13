// The runtime guard (hardening.ts, refuseLoose): a renderer made with anything but the full
// hardening, however it was made, is destroyed before it loads anything.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { secureWebPreferences } from "../../src/main/web-preferences.ts";
import { APP_DIR, launch, sleep } from "./launch.ts";

let app: ElectronApplication;
let page: Page;
const preload = join(APP_DIR, "dist", "preload.cjs");
const presenterFile = join(APP_DIR, "dist", "presenter.html");

interface Seen {
  readonly events: string[];
  readonly destroyed: boolean;
  readonly windows: number;
  readonly loadFailed: boolean;
}

before(async () => {
  ({ app, page } = await launch());
  // Registered after the app's own guard: records what each new renderer got to do.
  await app.evaluate(({ app: electron }) => {
    const log: Record<number, string[]> = {};
    (globalThis as unknown as { __seen: typeof log }).__seen = log;
    electron.on("web-contents-created", (_e, c) => {
      const id = c.id;
      log[id] = ["created"];
      for (const ev of ["did-start-loading", "dom-ready", "did-finish-load", "did-navigate", "destroyed"] as const) c.on(ev as "dom-ready", () => log[id]!.push(ev));
    });
  });
});
after(async () => {
  await app?.close();
});

async function makeWindow(webPreferences: Record<string, unknown>): Promise<Seen> {
  return app.evaluate(
    async ({ BrowserWindow }, { webPreferences, presenterFile }) => {
      const before = BrowserWindow.getAllWindows().length;
      const w = new BrowserWindow({ show: false, webPreferences });
      const id = w.webContents.id;
      let loadFailed = false;
      try {
        await w.loadFile(presenterFile);
      } catch {
        loadFailed = true;
      }
      for (let i = 0; i < 50 && !w.isDestroyed(); i++) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 200));
      const log = (globalThis as unknown as { __seen: Record<number, string[]> }).__seen;
      return { events: log[id] ?? [], destroyed: w.isDestroyed(), windows: BrowserWindow.getAllWindows().length - before, loadFailed };
    },
    { webPreferences, presenterFile },
  );
}

function assertRefused(s: Seen): void {
  assert.equal(s.destroyed, true, "destroyed");
  assert.equal(s.windows, 0, "no window left");
  assert.equal(s.loadFailed, true, "loadFile fails");
  for (const ev of ["dom-ready", "did-finish-load", "did-navigate"]) assert.ok(!s.events.includes(ev), `${ev} in ${s.events.join(",")}`);
  assert.ok(s.events.includes("destroyed"));
}

test("a window with the full hardening loads (control)", async () => {
  const s = await app.evaluate(
    async ({ BrowserWindow }, { webPreferences, presenterFile }) => {
      const w = new BrowserWindow({ show: false, webPreferences });
      await w.loadFile(presenterFile);
      const ok = await w.webContents.executeJavaScript("typeof window.player");
      w.destroy();
      return ok;
    },
    { webPreferences: secureWebPreferences(preload) as unknown as Record<string, unknown>, presenterFile },
  );
  assert.equal(s, "object");
});

test("a window without the sandbox is destroyed and never loads", async () => {
  assertRefused(await makeWindow({ ...secureWebPreferences(preload), sandbox: false }));
});

test("a window with Node in the page is destroyed and never loads", async () => {
  assertRefused(await makeWindow({ ...secureWebPreferences(preload), nodeIntegration: true, contextIsolation: false }));
});

test("a window on another session is destroyed and never loads", async () => {
  assertRefused(await makeWindow({ ...secureWebPreferences(preload), partition: "loose-test" }));
});

// The keys Electron does not report (#151 review, N2): the preload and the spell checker.
test("the session's spell checker is off and no session preload is registered", async () => {
  const r = await app.evaluate(({ session }) => ({ spell: session.defaultSession.isSpellCheckerEnabled(), preloads: session.defaultSession.getPreloadScripts().length }));
  assert.deepEqual(r, { spell: false, preloads: 0 });
});

test("a window with another preload, or none, is destroyed and never loads", async () => {
  assertRefused(await makeWindow({ ...secureWebPreferences(join(APP_DIR, "dist", "other-preload.cjs")) }));
  const none: Record<string, unknown> = { ...secureWebPreferences(preload) };
  delete none.preload;
  assertRefused(await makeWindow(none));
});

test("the room preload is allowed, as the room window has it (control)", async () => {
  const s = await app.evaluate(
    async ({ BrowserWindow }, { webPreferences, presenterFile }) => {
      const w = new BrowserWindow({ show: false, webPreferences });
      await w.loadFile(presenterFile);
      const alive = !w.isDestroyed();
      w.destroy();
      return alive;
    },
    { webPreferences: secureWebPreferences(join(APP_DIR, "dist", "room-preload.cjs")) as unknown as Record<string, unknown>, presenterFile },
  );
  assert.equal(s, true);
});

test("with the spell checker back on, or a session preload, a hardened window is refused", async () => {
  const secure = secureWebPreferences(preload) as unknown as Record<string, unknown>;
  await app.evaluate(({ session }) => session.defaultSession.setSpellCheckerEnabled(true));
  try {
    assertRefused(await makeWindow(secure));
  } finally {
    await app.evaluate(({ session }) => session.defaultSession.setSpellCheckerEnabled(false));
  }
  const id = await app.evaluate(({ session }, filePath) => session.defaultSession.registerPreloadScript({ type: "frame", filePath }), preload);
  try {
    assertRefused(await makeWindow(secure));
  } finally {
    await app.evaluate(({ session }, id) => session.defaultSession.unregisterPreloadScript(id), id);
  }
});

test("a view with loose preferences is destroyed and never loads", async () => {
  const s = await app.evaluate(
    async ({ WebContentsView }, { webPreferences, presenterFile }) => {
      const v = new WebContentsView({ webPreferences });
      const wc = v.webContents;
      const id = wc.id;
      let loadFailed = false;
      try {
        await wc.loadFile(presenterFile);
      } catch {
        loadFailed = true;
      }
      for (let i = 0; i < 50 && !wc.isDestroyed(); i++) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 200));
      const log = (globalThis as unknown as { __seen: Record<number, string[]> }).__seen;
      return { events: log[id] ?? [], destroyed: wc.isDestroyed(), windows: 0, loadFailed };
    },
    { webPreferences: { ...secureWebPreferences(preload), sandbox: false, nodeIntegration: true } as Record<string, unknown>, presenterFile },
  );
  assertRefused(s);
});

test("window.open allowed with loose options is destroyed and never loads", async () => {
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const known = await app.evaluate(() => Object.keys((globalThis as unknown as { __seen: Record<number, string[]> }).__seen).map(Number));
  // The app denies every window.open; this lets one through with loose options, as a mistake would.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.webContents.setWindowOpenHandler(() => ({
      action: "allow",
      overrideBrowserWindowOptions: { show: false, webPreferences: { sandbox: false, contextIsolation: false, nodeIntegration: true } },
    }));
  });
  try {
    // Opened on a timer: the guard closes the new window inside window.open, which can leave the
    // opener waiting (hardening.ts), so the test does not wait on the page.
    await page.evaluate(() => void setTimeout(() => window.open(location.href), 0));
    await sleep(800);
    const r = await app.evaluate(({ BrowserWindow, webContents }, known) => {
      const log = (globalThis as unknown as { __seen: Record<number, string[]> }).__seen;
      const opened = Object.keys(log).map(Number).filter((id) => !known.includes(id));
      return {
        windows: BrowserWindow.getAllWindows().length,
        opened: opened.map((id) => ({ events: log[id]!, alive: webContents.fromId(id) !== undefined })),
      };
    }, known);
    assert.equal(r.windows, before, "no window left");
    assert.equal(r.opened.length, 1, "window.open made one renderer");
    const opened = r.opened[0]!;
    assert.equal(opened.alive, false);
    for (const ev of ["dom-ready", "did-finish-load"]) assert.ok(!opened.events.includes(ev), `${ev} in ${opened.events.join(",")}`);
  } finally {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    });
  }
});
