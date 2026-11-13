// The built app starts on the class list (docs/design/class-list.md): the page is hardened, shows
// the not-paired state with nothing cached, answers only to its own channels, shows a class file
// that does not read as a plate and stays, and moves to the presenter when a file reads. No
// network: nothing is paired.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { NEWER_VERSION_MESSAGE } from "../../src/core/class-file.ts";
import { LIST_CSP } from "../../src/main/web-preferences.ts";
import { converterExamples, EXAMPLES } from "../unit/fixtures.ts";
import { launch } from "./launch.ts";

let app: ElectronApplication;
let page: Page;

before(async () => {
  ({ app, page } = await launch({ page: "list" }));
});
after(async () => {
  await app?.close();
});

async function openFromMenu(path: string): Promise<void> {
  await app.evaluate(({ dialog, Menu }, p) => {
    // Answer the next file dialog as a user would; the menu item is the real one.
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
    Menu.getApplicationMenu()?.getMenuItemById("open-class")?.click();
  }, path);
}

test("the app starts on the class list, hardened: its own policy, its fonts, no Node", async () => {
  assert.match(page.url(), /\/dist\/classlist\.html$/);
  assert.equal(await page.locator("h1").innerText(), "Classes");
  const meta = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"));
  assert.equal(meta, LIST_CSP);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`).sort();
  });
  assert.ok(fonts.some((f) => f.includes("Atkinson Hyperlegible")) && fonts.some((f) => f.includes("Big Shoulders Display")), fonts.join(", "));
  const r = await page.evaluate(() => ({ require: typeof (globalThis as Record<string, unknown>).require, process: typeof (globalThis as Record<string, unknown>).process }));
  assert.deepEqual(r, { require: "undefined", process: "undefined" });
  assert.equal(await page.evaluate(async () => {
    try {
      await fetch("https://example.invalid/");
      return "fetched";
    } catch {
      return "blocked";
    }
  }), "blocked");
});

test("nothing is paired: the status says so, the panel offers pairing and the file, and the list's channels answer", async () => {
  await page.waitForSelector('#app[data-body="not-paired"]');
  assert.equal(await page.locator(".status .st").innerText(), "Not paired");
  assert.equal(await page.locator(".panel h2").innerText(), "No classes on this computer");
  const view = (await page.evaluate(() => (window as unknown as { player: { listView(): Promise<unknown> } }).player.listView())) as { rows: unknown[]; sync: { status: string }; pairing: { state: string } };
  assert.deepEqual([view.rows.length, view.sync.status, view.pairing.state], [0, "unpaired", "unpaired"]);
  // The clock's channels are not this page's.
  assert.equal(await page.evaluate(() => (window as unknown as { player: { getState(): Promise<unknown> } }).player.getState()), null);
});

test("a class file that does not read is a plate with its name; the list stays; Esc closes it", async () => {
  await openFromMenu(join(EXAMPLES, "reader", "rejected-unknown-major.json"));
  await page.waitForSelector('#file-slot [role="alert"]');
  assert.equal(await page.locator('#file-slot .st').innerText(), NEWER_VERSION_MESSAGE);
  assert.equal(await page.locator("#file-slot .dt").innerText(), "rejected-unknown-major.json was not opened.");
  assert.match(page.url(), /classlist\.html$/);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector("#file-slot [role='alert']") === null);
});

test("a class file that reads goes to the presenter, and the Class list menu item comes back", async () => {
  const [first] = converterExamples();
  const doc = JSON.parse(readFileSync(first, "utf8"));
  await openFromMenu(first);
  await page.waitForFunction(() => location.pathname.endsWith("/presenter.html"));
  await page.waitForFunction((t) => document.getElementById("title")?.textContent === t, doc.class.title);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("class-list")?.click());
  await page.waitForFunction(() => location.pathname.endsWith("/classlist.html"));
  await page.waitForSelector("#app[data-body]");
  assert.equal(await page.locator("h1").innerText(), "Classes");
});
