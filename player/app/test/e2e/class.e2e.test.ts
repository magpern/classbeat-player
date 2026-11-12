// Open an example class (drag and drop, and the File menu), start, pause, skip; a class needing a
// newer player is refused plainly and the open class keeps going.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { NEWER_VERSION_MESSAGE } from "../../src/core/class-file.ts";
import { converterExamples, EXAMPLES } from "../unit/fixtures.ts";
import { launch, sleep } from "./launch.ts";

let app: ElectronApplication;
let page: Page;

before(async () => {
  ({ app, page } = await launch());
});
after(async () => {
  await app?.close();
});

const text = (id: string): Promise<string> => page.locator(`#${id}`).innerText();
const seconds = (mmss: string): number => {
  const [m, s] = mmss.split(":").map(Number);
  return m * 60 + s;
};

async function drop(path: string): Promise<void> {
  await page.evaluate(
    ({ name, body }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([body], name, { type: "application/json" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    { name: basename(path), body: readFileSync(path, "utf8") },
  );
}

async function openFromMenu(path: string): Promise<void> {
  await app.evaluate(({ dialog, Menu }, p) => {
    // Answer the next file dialog as a user would; the menu item is the real one.
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
    Menu.getApplicationMenu()?.getMenuItemById("open-class")?.click();
  }, path);
}

test("open an example class, start, pause and skip", { timeout: 60_000 }, async () => {
  const [first, second] = converterExamples();
  const doc = JSON.parse(readFileSync(first, "utf8"));
  await drop(first);
  await page.waitForFunction((t) => document.getElementById("title")?.textContent === t, doc.class.title);
  assert.equal(await page.locator("#intervals tr").count(), doc.intervals.length);
  assert.equal(await text("status"), "ready");

  await page.click("#start");
  await page.waitForFunction(() => document.getElementById("class-time")?.textContent === "0:02");
  assert.equal(await text("status"), "running");

  await page.click("#pause");
  await page.waitForFunction(() => document.getElementById("status")?.textContent === "paused");
  const paused = await text("class-time");
  await sleep(1500);
  assert.equal(await text("class-time"), paused, "a paused clock does not move");

  await page.click("#next");
  await page.waitForFunction(() => document.getElementById("interval-number")?.textContent === "2");
  assert.equal(seconds(await text("class-time")), doc.intervals[1].start_ms / 1000);
  assert.equal(await text("status"), "paused");
  assert.equal(await page.locator('#intervals tr[aria-current="true"] td:nth-child(2)').innerText(), "2");

  await page.click("#resume");
  await page.waitForFunction(() => document.getElementById("status")?.textContent === "running");
  await page.click("#forward5");
  await page.click("#previous");
  await page.waitForFunction(() => document.getElementById("interval-number")?.textContent === "2");

  // A class that needs a newer player: refused plainly, the open class keeps running.
  await openFromMenu(join(EXAMPLES, "reader", "rejected-unknown-major.json"));
  await page.waitForFunction((m) => document.getElementById("error")?.textContent === m, NEWER_VERSION_MESSAGE);
  assert.equal(await text("title"), doc.class.title);
  assert.equal(await text("status"), "running");

  // File menu with a valid class: it replaces the open one, ready at 0.
  const doc2 = JSON.parse(readFileSync(second, "utf8"));
  await openFromMenu(second);
  await page.waitForFunction((t) => document.getElementById("title")?.textContent === t, doc2.class.title);
  assert.equal(await page.locator("#error").isHidden(), true);
  assert.equal(await text("status"), "ready");
  assert.equal(await text("class-time"), "0:00");
});
