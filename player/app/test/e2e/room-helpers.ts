// What the room window's e2e tests share: finding the windows, the File menu, opening a class
// file through a stubbed dialog, and a picture of the whole (virtual) screen as the system draws
// it, stacking order included.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ElectronApplication, Page } from "playwright-core";
import { converterExamples } from "../unit/fixtures.ts";
import { sleep } from "./launch.ts";

export async function waitFor(cond: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(100);
  }
  assert.fail(`timed out waiting for ${what}`);
}

/**
 * `promise`, or a failure naming `what` after `ms`. Playwright puts no limit on evaluate (in the
 * app or a page), so a call that never answers would otherwise hang the whole CI job unnamed.
 */
export async function within<T>(ms: number, what: string, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms: ${what}`)), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}
const STEP_MS = 10_000;

export const windowCount = (app: ElectronApplication): Promise<number> =>
  within(STEP_MS, "count the windows", app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length));
export const roomPage = (app: ElectronApplication): Page | undefined => app.windows().find((w) => !w.isClosed() && w.url().endsWith("/dist/room.html"));
export async function theRoom(app: ElectronApplication): Promise<Page> {
  await waitFor(async () => roomPage(app) !== undefined, 10_000, "the room window");
  const room = roomPage(app)!;
  await room.waitForLoadState("domcontentloaded");
  return room;
}
export const menu = (app: ElectronApplication, id: string): Promise<void> =>
  within(STEP_MS, `the menu item ${id}`, app.evaluate(({ Menu }, i) => Menu.getApplicationMenu()?.getMenuItemById(i)?.click(), id));
export const onPage = (page: Page, name: string): Promise<unknown> => page.waitForFunction((n) => location.pathname.endsWith(`/${n}`), name);
/** Closes the room window the way the instructor's window manager does. */
export const closeRoomByHand = (app: ElectronApplication): Promise<void> =>
  within(
    STEP_MS,
    "close the room window by hand",
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith("/dist/room.html"))?.close()),
  );

/** File > Open a class file, with the dialog answering the first converter example. Returns its title. */
export async function openClassFile(app: ElectronApplication): Promise<string> {
  const [first] = converterExamples();
  await app.evaluate(({ dialog, Menu }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
    Menu.getApplicationMenu()?.getMenuItemById("open-class")?.click();
  }, first);
  return (JSON.parse(readFileSync(first!, "utf8")) as { class: { title: string } }).class.title;
}

export interface Screen {
  readonly width: number;
  readonly height: number;
  /** BGRA, row after row. */
  readonly bitmap: Buffer;
  readonly png: Buffer;
}

/** The primary screen as the system composes it (desktopCapturer, in the main process). */
export async function captureScreen(app: ElectronApplication): Promise<Screen> {
  const got = await app.evaluate(async ({ desktopCapturer, screen }) => {
    const { width, height } = screen.getPrimaryDisplay().size;
    const [src] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } });
    if (!src) return null;
    const size = src.thumbnail.getSize();
    return { width: size.width, height: size.height, bitmap: src.thumbnail.toBitmap().toString("base64"), png: src.thumbnail.toPNG().toString("base64") };
  });
  assert.ok(got && got.width > 0, "a picture of the screen");
  return { width: got.width, height: got.height, bitmap: Buffer.from(got.bitmap, "base64"), png: Buffer.from(got.png, "base64") };
}

/** The share of a rectangle's pixels that are near white (the presenter page) on the screen. */
export function whiteShare(s: Screen, r: { x: number; y: number; width: number; height: number }): number {
  let white = 0;
  let all = 0;
  for (let y = Math.max(0, r.y); y < Math.min(s.height, r.y + r.height); y += 2) {
    for (let x = Math.max(0, r.x); x < Math.min(s.width, r.x + r.width); x += 2) {
      const i = (y * s.width + x) * 4;
      all++;
      if (s.bitmap[i]! > 235 && s.bitmap[i + 1]! > 235 && s.bitmap[i + 2]! > 235) white++;
    }
  }
  return all === 0 ? 0 : white / all;
}
