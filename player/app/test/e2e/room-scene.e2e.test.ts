// The real 3D scene in the room window (#824): every other room e2e uses a class without songs, which the scene never draws (the
// plain screen stays, data-scene=off). Here the class has songs, so the scene mounts (data-scene=on, a canvas drawn), and a frame
// rate forced low steps the quality down to the plain screen with the class clock running on. Built app, fake backend on loopback.
// The slow rate is forced from the test: the room page's requestAnimationFrame is wrapped from outside (the scene asks for it at
// each frame), so the app has no test-only switch for it.
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { classWithSongs } from "../unit/scene-fixtures.ts";
import { ID_A } from "../unit/sync-fixtures.ts";
import { closeApp, launch } from "./launch.ts";
import { startBackend } from "./room-backend.ts";
import { onPage, theRoom, waitFor, within } from "./room-helpers.ts";

const T = { timeout: 120_000 };
let server: Server;
let app: ElectronApplication;
let page: Page;
let room: Page;
/** The scene's own frame-rate log lines (room-scene-log.ts), as the room page wrote them to its console. */
const rows: { fps: number; level: string }[] = [];
const SLOW_MS = 400;

before(async () => {
  let origin: string;
  ({ server, origin } = await startBackend(classWithSongs()));
  ({ app, page } = await launch({ page: "list", args: ["--test-memory-keychain"], env: { PLAYER_BACKEND_ORIGIN: origin } }));
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => undefined;
  });
}, T);
after(async () => {
  await closeApp(app);
  server?.closeAllConnections();
  server?.close();
}, T);

const command = (cmd: object): Promise<unknown> => page.evaluate((c) => (window as unknown as { player: { command(c: unknown): Promise<unknown> } }).player.command(c), cmd);
const scene = (): Promise<string | undefined> => room.evaluate(() => document.documentElement.dataset.scene);
const remaining = (): Promise<number | undefined> =>
  room.evaluate(async () => ((await (window as unknown as { room: { state(): Promise<{ view: { classRemainingMs: number } | null } | null> } }).room.state())?.view?.classRemainingMs));

test("a class with songs: the scene mounts in the room window and draws its canvas", T, async () => {
  await page.waitForSelector('#app[data-body="not-paired"]');
  await page.locator('[data-action="pair"]').first().click();
  await page.waitForSelector(`#list [data-id="${ID_A}"]`, { timeout: 30_000 });
  await page.locator('footer [data-action="start"]').click();
  await onPage(page, "presenter.html");
  room = await theRoom(app);
  room.on("console", (m) => {
    const r = /^scene frame rate: second=\d+ fps=(\d+(?:\.\d+)?) level=(\w+)$/.exec(m.text());
    if (r) rows.push({ fps: Number(r[1]), level: r[2]! });
  });
  // Nothing is forced here: the scene must be on before any step-down (which software GL may begin by itself some seconds later).
  await waitFor(async () => (await scene()) === "on", 60_000, "data-scene=on");
  // A canvas that was drawn on: the WebGL context exists and has a size, and it is the one the page shows.
  const canvas = await room.evaluate(() => {
    const c = document.getElementById("scene") as HTMLCanvasElement | null;
    return c === null ? null : { w: c.width, h: c.height, shown: getComputedStyle(document.getElementById("scene-join")!).display };
  });
  assert.ok(canvas && canvas.w > 0 && canvas.h > 0, "the scene canvas has a size");
  assert.equal(canvas.shown, "block");
});

test("a forced slow frame rate ends on the plain screen, and the class clock goes on", T, async () => {
  await command({ type: "start" });
  await waitFor(async () => (await remaining()) !== undefined, 10_000, "the running class");
  const before = (await within(10_000, "read the clock", remaining()))!;
  // About 2.5 frames a second, from the next frame on.
  const mark = rows.length;
  await room.evaluate((ms) => {
    const w = window as unknown as { requestAnimationFrame(cb: FrameRequestCallback): number };
    const g = window as unknown as { slowFrames: number };
    g.slowFrames = 0;
    w.requestAnimationFrame = (cb) => window.setTimeout(() => { g.slowFrames++; cb(performance.now()); }, ms);
  }, SLOW_MS);
  await waitFor(async () => (await scene()) === "off", 90_000, "the plain screen after the step-downs");
  // What the scene itself measured after the wrap (the first sample may straddle it): never faster than the forced rate allows.
  const seen = rows.slice(mark + 1);
  assert.ok(seen.length >= 1, "the scene logged samples while it was slowed");
  assert.ok(seen.every((r) => r.fps <= 3), `the forced rate decided the frame rate: ${JSON.stringify(seen)}`);
  // The scene took its frames through the wrap (not through the real frame clock), at the forced pace: at most one per SLOW_MS.
  const wrapped = await room.evaluate(() => (window as unknown as { slowFrames: number }).slowFrames);
  assert.ok(wrapped >= 3, `the scene's frames came through the wrapped requestAnimationFrame (${wrapped})`);
  const after = (await within(10_000, "read the clock", remaining()))!;
  assert.ok(after < before, `the class clock continued (${before} to ${after})`);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await scene(), "off", "it stays on the plain screen");
  assert.ok((await remaining())! < after, "and the clock still goes on");
  assert.equal(await room.locator(".gel").count() > 0, true, "the plain screen is the one drawn");
});
