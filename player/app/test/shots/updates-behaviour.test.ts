// How the update notice and the Settings page behave under the keyboard and the mouse
// (docs/design/updates.md, "Keyboard" and "The switches"), on the real class list page in headless
// Chrome with a stand-in bridge that records the asks. Every ask carries no argument but the two
// switches' booleans; Esc on Settings goes back and closes nothing on the list; the dimmed
// "Check now" is measured on the screenshot (U2: at least 7 : 1).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { launchChrome, openList } from "./page.ts";
import type { Opened } from "./page.ts";
import { decodePng } from "./png-luma.ts";
import { STATES } from "./states.ts";
import { NEWER, U } from "./update-states.ts";

let browser: Browser;
before(async () => {
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

const state = (name: string) => STATES.find((s) => s.name === name)!.view;
const SIZE = [1000, 720] as const;
const focused = (o: Opened): Promise<string> => o.page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  return el?.id || el?.dataset.action || "";
});
const setUpdate = (o: Opened, v: unknown): Promise<void> => o.page.evaluate((x) => void ((window as unknown as { __update: unknown }).__update = x), v);

async function open(update: unknown, list = "synced"): Promise<Opened> {
  const o = await openList(browser, SIZE, state(list), "no-preference", update);
  if (update !== null) await o.page.waitForSelector("#settings-key");
  await o.page.waitForTimeout(600);
  return o;
}
async function settings(o: Opened): Promise<void> {
  await o.page.keyboard.press("Control+,");
  await o.page.waitForSelector("#settings-app:not([hidden])");
}

test("Ctrl+, opens Settings with the focus on Open release page for a newer version, else on Check now; Esc goes back to the Settings key", async () => {
  for (const [update, first] of [[NEWER, "open-release"], [U({}), "u-check"]] as const) {
    const o = await open(update);
    try {
      await settings(o);
      assert.equal(await focused(o), first);
      await o.page.keyboard.press("Escape");
      assert.equal(await o.page.locator("#settings-app").isHidden(), true);
      assert.equal(await o.page.locator("#app").isVisible(), true);
      assert.equal(await focused(o), "settings-key");
      assert.deepEqual(await o.calls(), []);
    } finally {
      await o.close();
    }
  }
});

test("the Settings key opens Settings with a click, and Back returns", async () => {
  const o = await open(U({}));
  try {
    await o.page.click("#settings-key");
    assert.equal(await o.page.locator("#settings-app").isVisible(), true);
    await o.page.click("#settings-back");
    assert.equal(await o.page.locator("#app").isVisible(), true);
  } finally {
    await o.close();
  }
});

test("Check now asks with no argument; while a check runs it is dimmed, keeps the focus and asks nothing", async () => {
  const o = await open(U({}));
  try {
    await settings(o);
    await o.page.click("#u-check");
    assert.deepEqual(await o.calls(), [["update-check"]]);
    await setUpdate(o, U({ kind: "checking" }));
    await o.page.waitForSelector('#u-check[aria-disabled="true"]');
    await o.page.focus("#u-check");
    // Playwright waits for an aria-disabled button to be enabled; a person can still press it.
    await o.page.click("#u-check", { force: true });
    await o.page.keyboard.press("Enter");
    assert.deepEqual(await o.calls(), [["update-check"]]);
    assert.equal(await focused(o), "u-check");
  } finally {
    await o.close();
  }
});

test("Open release page asks with no argument, from the notice and from Settings", async () => {
  const o = await open(NEWER);
  try {
    await o.page.click('#update-notice [data-action="open-release"]');
    await settings(o);
    await o.page.click('#u-status [data-action="open-release"]');
    assert.deepEqual(await o.calls(), [["update-open"], ["update-open"]]);
  } finally {
    await o.close();
  }
});

test("the switches ask with one boolean each, by click, Space and Enter", async () => {
  const o = await open(U({ auto: true, prereleases: false }));
  try {
    await settings(o);
    await o.page.click("#u-auto");
    await o.page.focus("#u-pre");
    await o.page.keyboard.press(" ");
    await o.page.keyboard.press("Enter");
    assert.deepEqual(await o.calls(), [["update-auto", false], ["update-pre", true], ["update-pre", true]]);
    assert.equal(await o.page.getAttribute("#u-auto", "aria-checked"), "true");
  } finally {
    await o.close();
  }
});

test("the notice is not shown over a plate, and Esc on Settings does not dismiss the plate", async () => {
  const o = await open(NEWER, "file-error");
  try {
    assert.equal(await o.page.locator("#update-notice").isHidden(), true);
    await settings(o);
    await o.page.keyboard.press("Escape");
    assert.deepEqual(await o.calls(), []);
    assert.equal(await o.page.locator("#update-notice").isHidden(), true);
  } finally {
    await o.close();
  }
});

test("a class opening (a null status) takes Settings back to the list and removes the key and the notice", async () => {
  const o = await open(NEWER);
  try {
    await settings(o);
    await setUpdate(o, null);
    await o.page.waitForSelector("#settings-app", { state: "hidden" });
    await o.page.waitForSelector("#settings-key", { state: "detached" });
    assert.equal(await o.page.locator("#update-notice").isHidden(), true);
    await o.page.keyboard.press("Control+,");
    assert.equal(await o.page.locator("#settings-app").isHidden(), true);
  } finally {
    await o.close();
  }
});

test("U2: the dimmed Check now measures at least 7 : 1 on the screenshot", async () => {
  const o = await open(U({ kind: "checking" }));
  try {
    await settings(o);
    await o.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const box = (await o.page.locator("#u-check").boundingBox())!;
    // Inside the border: the key's own colour and the words on it.
    const clip = { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 };
    const p = decodePng(await o.page.screenshot({ clip, animations: "disabled" }));
    const lin = (c: number): number => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    const counts = new Map<number, number>();
    let text = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      const l = 0.2126 * lin(p.data[i]!) + 0.7152 * lin(p.data[i + 1]!) + 0.0722 * lin(p.data[i + 2]!);
      text = Math.max(text, l);
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    const key = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    const ratio = (text + 0.05) / (key + 0.05);
    assert.ok(ratio >= 7, `dimmed Check now: ${ratio.toFixed(1)} : 1`);
    console.log(`# dimmed Check now: ${ratio.toFixed(1)} : 1`);
  } finally {
    await o.close();
  }
});
