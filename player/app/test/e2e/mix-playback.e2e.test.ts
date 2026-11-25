// Mix playback in the room window on the built app (issue #693; ADR 0013 section 5): with the
// test-only fake source (`--test-fake-mix`, honoured unpackaged only), opening a Swedebeat mix class
// starts its download, and Start plays the mix in the room's <audio> from `cbp-mix:` while the
// download goes on. The session's request filter (hardening.ts) sees those requests: the room
// window's live play passes; the same URL from any other window, or with no window, and a stale
// play id from the room itself are refused before the scheme handler runs. All in memory and on
// disk under a temporary folder: no network, no account, no real source.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { toneWav } from "../../src/main/mix/test-mix.ts";
import { secureWebPreferences } from "../../src/main/web-preferences.ts";
import { APP_DIR, closeApp, launch } from "./launch.ts";
import { menu, onPage, theRoom, waitFor, within } from "./room-helpers.ts";

const T = { timeout: 120_000 };
const MIX_CLASS = join(
  APP_DIR,
  "..",
  "..",
  "schema",
  "class-format",
  "v1",
  "examples",
  "valid",
  "class-swedebeat-mix-no-offset-exact-fit.json",
);
const BLOCKED = "net::ERR_BLOCKED_BY_CLIENT";
const userData = mkdtempSync(join(tmpdir(), "player-e2e-mix-"));
let app: ElectronApplication;
let page: Page;

type Seen = { url: string; wc: number | null; status?: number; error?: string };

before(async () => {
  ({ app, page } = await launch({
    page: "list",
    userData,
    args: ["--test-fake-mix"],
  }));
  // Every `cbp-mix:` request the session answered or refused, with the window it came from. These
  // listeners only watch; the hardening's onBeforeRequest filter is still the one that decides.
  await app.evaluate(({ session }) => {
    const g = globalThis as unknown as { __mix: Seen[] };
    g.__mix = [];
    const wr = session.defaultSession.webRequest;
    wr.onResponseStarted(
      (d) =>
        void (
          d.url.startsWith("cbp-mix:") &&
          g.__mix.push({
            url: d.url,
            wc: d.webContentsId ?? null,
            status: d.statusCode,
          })
        ),
    );
    wr.onErrorOccurred(
      (d) =>
        void (
          d.url.startsWith("cbp-mix:") &&
          g.__mix.push({
            url: d.url,
            wc: d.webContentsId ?? null,
            error: d.error,
          })
        ),
    );
  });
}, T);
after(async () => {
  await closeApp(app);
}, T);

const seen = (): Promise<Seen[]> =>
  app.evaluate(() => (globalThis as unknown as { __mix: Seen[] }).__mix);
const audio = (room: Page) =>
  room.evaluate(() => {
    const a = document.querySelector<HTMLAudioElement>("#mix")!;
    return {
      src: a.getAttribute("src"),
      time: a.currentTime,
      paused: a.paused,
    };
  });
/** The size of the mix's encrypted cache file: it grows chunk by chunk while the download goes on. */
function cachedBytes(): number {
  const dir = join(userData, "mixes", "a".repeat(64));
  if (!existsSync(dir)) return 0;
  const f = readdirSync(dir).find((n) => n.endsWith(".mix"));
  return f === undefined ? 0 : statSync(join(dir, f)).size;
}
/** Asks for `url` from a <audio> in a new, hardened, hidden window showing the room page: a window that is not the room window. */
const fromOtherWindow = (url: string): Promise<number> =>
  within(
    15_000,
    "the request from another window",
    app.evaluate(
      async ({ app: electron, BrowserWindow }, { url, webPreferences }) => {
        const w = new BrowserWindow({ show: false, webPreferences });
        // `?scene=off`: this window only asks for audio, so the room page builds no 3D scene (and no WebGL context) in it.
        await w.loadFile(`${electron.getAppPath()}/dist/room.html`, { query: { scene: "off" } });
        await w.webContents.executeJavaScript(
          `new Promise((r) => { const x = new Audio(${JSON.stringify(url)}); x.onerror = () => r(0); x.oncanplay = () => r(1); setTimeout(() => r(2), 5000); })`,
        );
        const id = w.webContents.id;
        w.destroy();
        return id;
      },
      {
        url,
        webPreferences: secureWebPreferences(
          join(APP_DIR, "dist", "room-preload.cjs"),
        ) as unknown as Record<string, unknown>,
      },
    ),
  );

test(
  "Start plays the mix from cbp-mix: before the download finishes; the filter refuses other windows and stale play ids",
  T,
  async () => {
    await page.waitForSelector("#app");
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [p],
      })) as typeof dialog.showOpenDialog;
    }, MIX_CLASS);
    await menu(app, "open-class");
    await onPage(page, "presenter.html");
    const room = await theRoom(app);
    await room.waitForSelector("#mix", { state: "attached" });
    await within(
      10_000,
      "Start",
      page.evaluate(() =>
        (
          window as unknown as {
            player: { command(c: unknown): Promise<unknown> };
          }
        ).player.command({ type: "start" }),
      ),
    );

    // The room's <audio> is cued to a play URL and plays, while the cache holds only part of the mix.
    await waitFor(
      async () => {
        const a = await audio(room);
        return a.src !== null && !a.paused && a.time > 0.2;
      },
      20_000,
      "the mix playing in the room",
    );
    const playingAt = cachedBytes();
    const { src } = await audio(room);
    assert.match(src!, /^cbp-mix:\/\/play\/[0-9a-f]{32}$/);
    const roomId = await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith("/dist/room.html"),
        )!.webContents.id,
    );
    const full = toneWav().length;
    assert.ok(
      playingAt > 0 && playingAt < full,
      `playing with ${playingAt} of about ${full} bytes cached`,
    );

    // The same play URL from any other window, and from no window, is refused by the filter.
    const otherId = await fromOtherWindow(src!);
    assert.notEqual(otherId, roomId);
    const noWindow = await app.evaluate(
      async ({ session }, u) =>
        session.defaultSession.fetch(u).then(
          () => "answered",
          (e: unknown) => String(e),
        ),
      src!,
    );
    assert.match(noWindow, /ERR_BLOCKED_BY_CLIENT/);
    // A play id that is not live is refused from the room window itself.
    const stale = `cbp-mix://play/${"0".repeat(32)}`;
    await room.evaluate(
      (u) => void new Audio(u).play().catch(() => undefined),
      stale,
    );

    await waitFor(
      async () => (await seen()).filter((s) => s.error === BLOCKED).length >= 3,
      10_000,
      "the three refusals",
    );
    const all = await seen();
    assert.ok(
      all.some(
        (s) =>
          s.url === src &&
          s.wc === roomId &&
          (s.status === 200 || s.status === 206),
      ),
      "the room's play answered",
    );
    assert.ok(
      all.some((s) => s.url === src && s.wc === otherId && s.error === BLOCKED),
      "another window refused",
    );
    assert.ok(
      all.some((s) => s.url === src && s.wc === null && s.error === BLOCKED),
      "no window refused",
    );
    assert.ok(
      all.some(
        (s) => s.url === stale && s.wc === roomId && s.error === BLOCKED,
      ),
      "a stale id refused",
    );
    assert.ok(
      !all.some((s) => s.wc !== roomId && s.status !== undefined),
      "nothing answered outside the room window",
    );

    // The download finishes while it plays, and the audio goes on.
    await waitFor(
      async () => cachedBytes() >= full,
      30_000,
      "the download to finish",
    );
    const after = await audio(room);
    assert.equal(after.paused, false);
    assert.equal(after.src, src);
  },
);
