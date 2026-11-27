// The instructor's music files keys on the real class list page (docs/design/music-files.md,
// "Keyboard"; #922): Find music files sends a class id and nothing else, Show which files opens the
// panel with Find focused, Esc goes back to the key that opened it, a held key does nothing, and
// everything from the class document is plain text. Headless Chrome over the fixture views; no
// Electron, no network. Needs `npm run build`.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import type { FilesView } from "../../src/core/music-files/files-view.ts";
import { FILES_STATES } from "./files-states.ts";
import { launchChrome, openList } from "./page.ts";
import type { State } from "./states.ts";

let browser: Browser;
before(async () => {
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

const SIZE = [1280, 800] as const;
const stateOf = (name: string): State => FILES_STATES.find((s) => s.name === `music-files-${name}`)!;
async function open(name: string, patch?: (v: State["view"]) => State["view"]) {
  const s = stateOf(name);
  const o = await openList(browser, SIZE, patch ? patch(s.view) : s.view);
  if (s.select !== undefined) await o.page.click(`#row-${s.select}`);
  return { o, id: s.select! };
}
const focused = (o: Awaited<ReturnType<typeof open>>["o"]): Promise<string | null> => o.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.action ?? null);

test("Find music files sends the class id and nothing else", async () => {
  const { o, id } = await open("missing");
  try {
    await o.page.click('[data-action="files-find"]');
    assert.deepEqual(await o.calls(), [["find", id]]);
  } finally {
    await o.close();
  }
});

test("Try again after a failed search asks again for the same class", async () => {
  const { o, id } = await open("find-failed");
  try {
    await o.page.click('#files-slot [data-action="files-find"]');
    assert.deepEqual(await o.calls(), [["find", id]]);
  } finally {
    await o.close();
  }
});

test("Show which files opens the panel with Find music files focused; Esc goes back to the key that opened it", async () => {
  const { o } = await open("missing");
  try {
    await o.page.click('[data-action="files-show"]');
    await o.page.waitForSelector('[data-panel="files-list"]');
    assert.equal(await o.page.locator(".mrow").count(), 2);
    assert.equal(await focused(o), "files-find");
    assert.deepEqual(await o.page.locator(".mrow .f").allTextContents(), ["neon_avenue_final_v2.mp3", "07 Pulse Theory (radio edit).flac"]);
    await o.page.keyboard.press("Escape");
    await o.page.waitForSelector("#list");
    assert.equal(await o.page.locator('[data-panel="files-list"]').count(), 0);
    assert.equal(await focused(o), "files-show");
    // Back is the same.
    await o.page.click('[data-action="files-show"]');
    await o.page.click('[data-action="files-back"]');
    await o.page.waitForSelector("#list");
    assert.deepEqual(await o.calls(), []);
  } finally {
    await o.close();
  }
});

test("when a search finds the last file the panel closes for good: a file lost later does not reopen it", async () => {
  const { o } = await open("missing");
  try {
    await o.page.click('[data-action="files-show"]');
    await o.page.waitForSelector('[data-panel="files-list"]');
    const missing = stateOf("missing").view;
    await o.setView({ ...missing, files: missing.files.map((f): FilesView => ({ ...f, missing: [] })) });
    await o.page.waitForSelector("#list");
    await o.setView(missing);
    await o.page.waitForTimeout(1200);
    assert.equal(await o.page.locator('[data-panel="files-list"]').count(), 0);
    assert.equal(await o.page.locator("#list").count(), 1);
  } finally {
    await o.close();
  }
});

test("while a search runs, Show, Find and Start are held: neither a click nor Enter does anything", async () => {
  for (const name of ["choosing", "finding", "checking"]) {
    const { o } = await open(name);
    try {
      const held = await o.page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".foot button")].map((b) => [b.dataset.action, b.disabled]));
      assert.deepEqual(held, [["files-show", true], ["files-find", true], ["start", true]], name);
      await o.page.focus("#list");
      await o.page.keyboard.press("Enter");
      assert.deepEqual(await o.calls(), [], name);
    } finally {
      await o.close();
    }
  }
});

test("held with an answer: Start and Find are held, Show which files stays live where a file is missing", async () => {
  const { o } = await open("held-missing");
  try {
    const held = await o.page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".foot button")].map((b) => [b.dataset.action, b.disabled]));
    assert.deepEqual(held, [["files-show", false], ["files-find", true], ["start", true]]);
    await o.page.focus("#list");
    await o.page.keyboard.press("Enter");
    assert.deepEqual(await o.calls(), []);
  } finally {
    await o.close();
  }
});

test("Start of a class with files missing is not refused: it starts, and the footer said it runs on the manual clock", async () => {
  const { o, id } = await open("missing");
  try {
    await o.page.focus("#list");
    await o.page.keyboard.press("Enter");
    const calls = await o.calls();
    assert.equal(calls.length, 1);
    assert.deepEqual([calls[0]![0], calls[0]![1]], ["start", id]);
  } finally {
    await o.close();
  }
});

test("a title, artist and file name from the class are plain text, never markup", async () => {
  const markup = '<img src="x" onerror="document.title=1"><b>bold</b>';
  const { o } = await open("missing", (v) => ({ ...v, files: v.files.map((f): FilesView => (f.missing.length === 2 ? { ...f, missing: [{ title: markup, artist: markup, fileName: markup }, ...f.missing.slice(1)] } : f)) }));
  try {
    await o.page.click('[data-action="files-show"]');
    await o.page.waitForSelector(".mrow");
    assert.equal(await o.page.locator(".mrow img, .mrow b").count(), 0);
    assert.equal((await o.page.locator(".mrow .t").first().textContent()) ?? "", markup);
    assert.deepEqual(o.external, []);
    assert.deepEqual(o.errors, []);
  } finally {
    await o.close();
  }
});
