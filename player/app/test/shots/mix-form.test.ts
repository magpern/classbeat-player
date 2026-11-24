// The Swedebeat sign-in form on the real page (docs/design/swedebeat.md, "The form"), in headless
// Chrome with a stand-in bridge that records the asks: what is typed goes to the bridge once and is
// cleared from the page before the answer; Cancel and Esc clear it without sending; sign-out asks first.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { launchChrome, openList } from "./page.ts";
import { STATES } from "./states.ts";

let browser: Browser;
before(async () => {
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

const state = (name: string) => STATES.find((s) => s.name === name)!.view;
const SIZE = [1280, 800] as const;
const PASSWORD = "SENTINEL-pw-7f3a9c";

test("Connect opens the form with the first field focused; Enter sends once and clears every field", async () => {
  const o = await openList(browser, SIZE, state("sw-signed-out"));
  try {
    // While signing in the shell answers "connecting"; hold the answer so the page is seen in between.
    await o.page.evaluate(() => {
      const w = window as unknown as { player: { mixSignIn: (c: Record<string, string>) => Promise<unknown> }; __seen: unknown; __release: () => void; __view: unknown };
      w.player.mixSignIn = (c) => {
        w.__seen = { keys: Object.keys(c), lengths: Object.values(c).map((x) => x.length) };
        return new Promise((r) => (w.__release = () => r(JSON.parse(JSON.stringify(w.__view)))));
      };
    });
    await o.page.click('[data-action="mix-connect"]');
    assert.equal(await o.page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.dataset.field), "username");
    assert.equal(await o.page.getAttribute('[data-field="password"]', "type"), "password");
    await o.page.keyboard.type("ana.k");
    await o.page.focus('[data-field="password"]');
    await o.page.keyboard.type(PASSWORD);
    await o.page.keyboard.press("Enter");
    assert.deepEqual(await o.page.evaluate(() => (window as unknown as { __seen: unknown }).__seen), { keys: ["username", "password"], lengths: [5, PASSWORD.length] });
    // Before the answer: nothing typed is left on the page.
    assert.ok(!(await o.page.content()).includes(PASSWORD));
    const values = await o.page.$$eval("input[data-field]", (xs) => xs.map((x) => (x as HTMLInputElement).value));
    assert.ok(values.every((v) => v === ""));
    await o.page.evaluate(() => (window as unknown as { __release: () => void }).__release());
    assert.deepEqual(o.errors, []);
    assert.deepEqual(o.external, []);
  } finally {
    await o.close();
  }
});

test("Cancel and Esc clear the fields and send nothing", async () => {
  const o = await openList(browser, SIZE, state("sw-signed-out"));
  try {
    for (const leave of ["click", "Escape"] as const) {
      await o.page.click('[data-action="mix-connect"]');
      await o.page.keyboard.type(PASSWORD);
      if (leave === "click") await o.page.click('[data-action="mix-cancel"]');
      else await o.page.keyboard.press("Escape");
      assert.equal(await o.page.$("[data-panel=mix-form]"), null, leave);
      assert.ok(!(await o.page.content()).includes(PASSWORD), leave);
    }
    assert.deepEqual((await o.calls()).filter((c) => String(c[0]).startsWith("mix")), []);
  } finally {
    await o.close();
  }
});

test("Sign out asks first, with Keep connected focused; Sign out sends no argument", async () => {
  const o = await openList(browser, SIZE, state("sw-signed-in"));
  try {
    await o.page.click('[data-action="mix-sign-out"]');
    assert.equal(await o.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.action), "mix-keep");
    await o.page.keyboard.press("Escape");
    assert.deepEqual(await o.calls(), []);
    await o.page.click('[data-action="mix-sign-out"]');
    await o.page.click('[data-action="mix-sign-out-yes"]');
    assert.deepEqual(await o.calls(), [["mix-sign-out"]]);
  } finally {
    await o.close();
  }
});
