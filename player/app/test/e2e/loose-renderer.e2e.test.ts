// The runtime guard (hardening.ts, refuseLoose): a renderer made with anything but the full
// hardening, however it was made, is destroyed before it loads anything.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { secureWebPreferences } from "../../src/main/web-preferences.ts";
import { APP_DIR, launch, sleep } from "./launch.ts";

let app: ElectronApplication;
let page: Page;
/** The presenter's window, found by id: a test never relies on the order of getAllWindows(). */
let presenterId: number;
const preload = join(APP_DIR, "dist", "preload.cjs");
const presenterFile = join(APP_DIR, "dist", "presenter.html");
/** Each test's own limit, so a hang fails that test by name (#156 review, N-3). */
const T = { timeout: 30_000 };
// A session preload that tells the main process it ran (#156 review, N-1): registered after a
// window loaded, it must never run, because the window is refused as its next load starts.
const PROBE_CHANNEL = "loose-renderer-probe";
const probeDir = mkdtempSync(join(tmpdir(), "player-probe-"));
const probe = join(probeDir, "probe-preload.cjs");
writeFileSync(probe, `require("electron").ipcRenderer.send(${JSON.stringify(PROBE_CHANNEL)});\n`);

interface Seen {
  readonly events: string[];
  readonly destroyed: boolean;
  readonly windows: number;
  readonly loadFailed: boolean;
}

before(async () => {
  ({ app, page } = await launch());
  presenterId = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    if (all.length !== 1) throw new Error(`expected the presenter alone, found ${all.length} windows`);
    return all[0]!.id;
  });
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
}, T);
after(async () => {
  try {
    await app?.close();
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}, T);

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
      const seen = { events: [...(log[id] ?? [])], destroyed: w.isDestroyed(), windows: BrowserWindow.getAllWindows().length - before, loadFailed };
      // A window that was not refused (a mutation, a bug) is destroyed here, so it cannot leak
      // into a later test (#154 review, N-5).
      if (!w.isDestroyed()) w.destroy();
      return seen;
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

test("a window with the full hardening loads (control)", T, async () => {
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

test("a window without the sandbox is destroyed and never loads", T, async () => {
  assertRefused(await makeWindow({ ...secureWebPreferences(preload), sandbox: false }));
});

test("a window with Node in the page is destroyed and never loads", T, async () => {
  assertRefused(await makeWindow({ ...secureWebPreferences(preload), nodeIntegration: true, contextIsolation: false }));
});

test("a window on another session is destroyed and never loads", T, async () => {
  assertRefused(await makeWindow({ ...secureWebPreferences(preload), partition: "loose-test" }));
});

// The keys Electron does not report (#151 review, N2): the preload and the spell checker.
test("the session's spell checker is off and no session preload is registered", T, async () => {
  const r = await app.evaluate(({ session }) => ({ spell: session.defaultSession.isSpellCheckerEnabled(), preloads: session.defaultSession.getPreloadScripts().length }));
  assert.deepEqual(r, { spell: false, preloads: 0 });
});

test("a window with another preload, or none, is destroyed and never loads", T, async () => {
  assertRefused(await makeWindow({ ...secureWebPreferences(join(APP_DIR, "dist", "other-preload.cjs")) }));
  const none: Record<string, unknown> = { ...secureWebPreferences(preload) };
  delete none.preload;
  assertRefused(await makeWindow(none));
});

test("the room preload is allowed, as the room window has it (control)", T, async () => {
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

test("with the spell checker back on, or a session preload, a hardened window is refused", T, async () => {
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

test("a view with loose preferences is destroyed and never loads", T, async () => {
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
      const seen = { events: [...(log[id] ?? [])], destroyed: wc.isDestroyed(), windows: 0, loadFailed };
      if (!wc.isDestroyed()) wc.close();
      return seen;
    },
    { webPreferences: { ...secureWebPreferences(preload), sandbox: false, nodeIntegration: true } as Record<string, unknown>, presenterFile },
  );
  assertRefused(s);
});

test("window.open allowed with loose options is destroyed and never loads", T, async () => {
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const known = await app.evaluate(() => Object.keys((globalThis as unknown as { __seen: Record<number, string[]> }).__seen).map(Number));
  // The app denies every window.open; this lets one through with loose options, as a mistake would.
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.fromId(id)!.webContents.setWindowOpenHandler(() => ({
      action: "allow",
      overrideBrowserWindowOptions: { show: false, webPreferences: { sandbox: false, contextIsolation: false, nodeIntegration: true } },
    }));
  }, presenterId);
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
    await app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.fromId(id)!.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    }, presenterId);
  }
});

// A renderer that is already hardened and loaded is checked again each time it starts loading
// (#154 review, N-3): a session preload registered, or the spell checker turned on, after it was
// created refuses it on its next load.
interface Reloaded {
  readonly before: boolean;
  readonly after: boolean;
  readonly domReady: boolean;
  readonly navigated: boolean;
  readonly probeRan: boolean;
}
async function reloadAfter(change: "spellChecker" | "sessionPreload"): Promise<Reloaded> {
  return app.evaluate(
    async ({ BrowserWindow, ipcMain, session }, { webPreferences, presenterFile, change, probe, channel }) => {
      const ses = session.defaultSession;
      const w = new BrowserWindow({ show: false, webPreferences });
      await w.loadFile(presenterFile);
      const before = !w.isDestroyed();
      let domReady = false;
      let navigated = false;
      let probeRan = false;
      // Kept anonymous: the bundled test code has no `__name` helper inside the app.
      const listeners = [(): void => void (probeRan = true)];
      ipcMain.on(channel, listeners[0]!);
      w.webContents.on("dom-ready", () => void (domReady = true));
      w.webContents.on("did-navigate", () => void (navigated = true));
      const id = change === "sessionPreload" ? ses.registerPreloadScript({ type: "frame", filePath: probe }) : null;
      if (change === "spellChecker") ses.setSpellCheckerEnabled(true);
      try {
        await w.loadFile(presenterFile).catch(() => undefined);
        for (let i = 0; i < 50 && !w.isDestroyed(); i++) await new Promise((r) => setTimeout(r, 20));
        // Time for a preload that did run to be heard.
        await new Promise((r) => setTimeout(r, 300));
        return { before, after: !w.isDestroyed(), domReady, navigated, probeRan };
      } finally {
        ipcMain.removeListener(channel, listeners[0]!);
        if (id !== null) ses.unregisterPreloadScript(id);
        ses.setSpellCheckerEnabled(false);
        if (!w.isDestroyed()) w.destroy();
      }
    },
    { webPreferences: secureWebPreferences(preload) as unknown as Record<string, unknown>, presenterFile, change, probe, channel: PROBE_CHANNEL },
  );
}

const REFUSED_ON_RELOAD: Reloaded = { before: true, after: false, domReady: false, navigated: false, probeRan: false };

test("a session preload registered later refuses a loaded window on its next load, and never runs", T, async () => {
  assert.deepEqual(await reloadAfter("sessionPreload"), REFUSED_ON_RELOAD);
});

test("the spell checker turned on later refuses a loaded window on its next load", T, async () => {
  assert.deepEqual(await reloadAfter("spellChecker"), REFUSED_ON_RELOAD);
});

// A getter that throws (an internal changed on an upgrade) refuses the renderer (#154 review, N-2).
test("a renderer whose state cannot be read is destroyed and never loads", T, async () => {
  await app.evaluate(({ session }) => {
    // Kept anonymous: the bundled test code has no `__name` helper inside the app.
    const throwing = [
      (): never => {
        throw new Error("changed on an upgrade");
      },
    ][0];
    Object.defineProperty(session.defaultSession, "isSpellCheckerEnabled", { configurable: true, value: throwing });
  });
  try {
    assertRefused(await makeWindow(secureWebPreferences(preload) as unknown as Record<string, unknown>));
  } finally {
    await app.evaluate(({ session }) => void delete (session.defaultSession as unknown as Record<string, unknown>).isSpellCheckerEnabled);
  }
  const r = await app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled());
  assert.equal(r, false, "restored");
});
