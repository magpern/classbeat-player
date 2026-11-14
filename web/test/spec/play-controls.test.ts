// The controls, the band and the keys of the web player page (docs/design/play.md, "Controls and keys"),
// on the fake site with a paused clock: Start, Pause, Resume, Previous, Next, End and its question, the
// band's rules, the keys, and the browser's own actions the page cancels (so a key never reloads the
// page and loses the class).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listAnswer } from "../lib/play-fake.ts";
import { countdown, harness, link, pill, status, text } from "../lib/play-drive.ts";
import { library } from "../lib/play-picker-states.ts";
import { opened, started, tapped, tickBy } from "../lib/play-states.ts";

const { open } = harness();

describe("the controls and the band", () => {
  it("opens before the start with the band pinned: Previous, Start, Next, End, and 'Press Start' in the link slot", async () => {
    const site = await open();
    await opened(site.page);
    assert.equal(await link(site.page), "Press Start");
    assert.deepEqual(await site.page.locator("[data-action]").evaluateAll((els) => els.map((e) => e.getAttribute("data-action"))), ["previous", "start", "next", "end"]);
    await tickBy(site.page, 4000);
    assert.equal(await site.page.locator(".controls").getAttribute("data-phase"), "shown", "pinned before the start");
    await site.context.close();
  });

  it("Start runs the class, hides the band 3 s later, and a tap shows it without pressing anything", async () => {
    const site = await open();
    await started(site.page);
    assert.equal(await link(site.page), "Manual clock");
    assert.equal(await site.page.locator(".controls").getAttribute("data-phase"), "hidden");
    const before = await countdown(site.page);
    // A tap where a button will be: the band is hidden, so the tap only shows it.
    await site.page.mouse.click(60, 800);
    await tickBy(site.page, 50);
    assert.equal(await site.page.locator(".controls").getAttribute("data-phase"), "shown");
    assert.equal(await status(site.page), "pause", "Start was not pressed again and Pause was not pressed by that tap");
    assert.equal(await site.page.locator(".pill").count(), 0, "the clock still runs");
    assert.ok(before.length > 0);
    await site.context.close();
  });

  it("Pause holds the countdown, Resume runs it on, Previous and Next move by an interval", async () => {
    const site = await open();
    await started(site.page);
    await tapped(site.page, [390, 844]);
    await site.page.click('[data-action="pause"]');
    await tickBy(site.page, 100);
    assert.equal(await pill(site.page), "Paused");
    assert.equal(await text(site.page, ".bars"), "Starts again when resumed");
    const held = await countdown(site.page);
    await tickBy(site.page, 5000);
    assert.equal(await countdown(site.page), held, "a paused clock holds");
    assert.equal(await status(site.page), "resume");
    await tapped(site.page, [390, 844]);
    await site.page.click('[data-action="resume"]');
    await tickBy(site.page, 1000);
    await tapped(site.page, [390, 844]);
    assert.notEqual(await countdown(site.page), held);
    await site.page.click('[data-action="next"]');
    await tickBy(site.page, 100);
    assert.equal(await text(site.page, ".gel-num"), "2", "Next goes to the second interval (zone 2)");
    await site.page.click('[data-action="previous"]');
    await tickBy(site.page, 100);
    assert.equal(await text(site.page, ".gel-num"), "1", "Previous within 3 s of an interval's start goes to the one before it");
    await site.context.close();
  });

  it("End opens the question with Keep going focused; Esc, 8 s and a tap outside answer it; End class leaves", async () => {
    const site = await open();
    await started(site.page);
    await site.page.keyboard.press("End");
    await tickBy(site.page, 50);
    assert.equal(await text(site.page, ".ask .q"), "End the class?");
    assert.deepEqual(await site.page.locator(".ask [data-action]").evaluateAll((els) => els.map((e) => e.getAttribute("data-action"))), ["end-class", "keep-going"]);
    assert.equal(await site.page.evaluate(() => document.activeElement?.getAttribute("data-action")), "keep-going", "Keep going has the focus");
    await site.page.keyboard.press("Escape");
    assert.equal(await site.page.locator(".ask").count(), 0, "Esc closes the question");
    await site.page.keyboard.press("End");
    await tickBy(site.page, 8100);
    assert.equal(await site.page.locator(".ask").count(), 0, "no answer in 8 s is Keep going");
    await site.page.keyboard.press("End");
    await site.page.mouse.click(200, 300);
    await tickBy(site.page, 50);
    assert.equal(await site.page.locator(".ask").count(), 0, "a tap outside the band is Keep going");
    // While the question is open the keys wait for the answer.
    await site.page.keyboard.press("End");
    await site.page.keyboard.press("Space");
    assert.equal(await site.page.locator(".ask").count(), 1, "Space does nothing while the question is open");
    await site.context.close();
  });

  it("has no Undo, Follow or Manual control anywhere", async () => {
    const site = await open();
    await started(site.page);
    await tapped(site.page, [390, 844]);
    const words = await site.page.locator("button").allTextContents();
    assert.deepEqual(words.filter((w) => /undo|follow|manual|music|sync/i.test(w)), []);
    await site.context.close();
  });
});


describe("the keys", () => {
  it("Space starts, pauses and resumes; the arrows and Page keys step; Shift jumps 5 s; End asks", async () => {
    const site = await open();
    await opened(site.page);
    await site.page.keyboard.press("Space");
    await tickBy(site.page, 5000);
    assert.equal(await link(site.page), "Manual clock", "Space started it");
    const t0 = await countdown(site.page);
    await site.page.keyboard.press("Shift+ArrowRight");
    await tickBy(site.page, 300);
    assert.notEqual(await countdown(site.page), t0, "Forward 5 s");
    await site.page.keyboard.press("Space");
    await tickBy(site.page, 300);
    assert.equal(await pill(site.page), "Paused");
    await site.page.keyboard.press("Space");
    await site.page.keyboard.press("ArrowRight");
    await tickBy(site.page, 300);
    assert.equal(await text(site.page, ".gel-num"), "2");
    await site.page.keyboard.press("PageDown");
    await tickBy(site.page, 300);
    assert.equal(await text(site.page, ".gel-num"), "3");
    await site.page.keyboard.press("PageUp");
    await tickBy(site.page, 300);
    assert.equal(await text(site.page, ".gel-num"), "2", "Page Up is Previous: within 3 s of an interval's start, the interval before it");
    await site.context.close();
  });

  it("F5 and Shift+F5 are Start before the start and nothing after it; B and the full stop do nothing", async () => {
    const site = await open();
    await opened(site.page);
    await site.page.keyboard.press("b");
    await site.page.keyboard.press(".");
    assert.equal(await status(site.page), "start", "the black-screen keys did nothing");
    await site.page.keyboard.press("Shift+F5");
    await tickBy(site.page, 5000);
    assert.equal(await link(site.page), "Manual clock", "Shift+F5 started it");
    await site.page.keyboard.press("F5");
    await site.page.keyboard.press("Shift+F5");
    await tickBy(site.page, 300);
    assert.equal(await pill(site.page), null, "after the start F5 does nothing: it does not pause");
    await site.context.close();
  });

  it("the page cancels the browser's action for F5, Shift+F5, Space, Page Up and Page Down while the class screen is open", async () => {
    const site = await open();
    await started(site.page);
    await site.page.evaluate(() => void ((window as unknown as { alive: number }).alive = 1));
    type Key = { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; repeat?: boolean };
    const cancelled = (init: Key): Promise<boolean> =>
      site.page.evaluate((i: Key) => {
        const e = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...i });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      }, init);
    for (const k of [{ key: "F5" }, { key: "F5", shiftKey: true }, { key: " " }, { key: "PageUp" }, { key: "PageDown" }, { key: "F5", ctrlKey: true }, { key: "r", ctrlKey: true }, { key: "r", metaKey: true }]) {
      assert.equal(await cancelled(k), true, JSON.stringify(k));
    }
    // Held keys are cancelled as well (a held Space must not scroll).
    assert.equal(await cancelled({ key: " ", repeat: true }), true);
    // Another key is left to the browser: Ctrl+Z, a letter, the arrow in a field.
    assert.equal(await cancelled({ key: "z", ctrlKey: true }), false);
    // And the real key reaches the page without reloading it.
    await site.page.keyboard.press("F5");
    await site.page.keyboard.press("Shift+F5");
    await site.page.keyboard.press("PageDown");
    assert.equal(await site.page.evaluate(() => (window as unknown as { alive?: number }).alive), 1, "the page was not reloaded");
    await site.context.close();
  });

  it("leaves the browser's keys alone on the picker, where nothing is lost by a reload", async () => {
    const site = await open({ hash: "", script: { "GET classes": listAnswer(library(3)) } });
    await site.page.waitForSelector(".rows .row");
    const cancelled = await site.page.evaluate(() => {
      const e = new KeyboardEvent("keydown", { key: "F5", cancelable: true, bubbles: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    assert.equal(cancelled, false);
    await site.context.close();
  });

  it("the band shows on Tab and on End, holds while a button has the keyboard's focus, and Esc hides it", async () => {
    const site = await open();
    await started(site.page);
    assert.equal(await site.page.locator(".controls").getAttribute("data-phase"), "hidden");
    await site.page.keyboard.press("Space");
    assert.equal(await site.page.locator(".controls").getAttribute("data-phase"), "hidden", "Space never shows the band");
    await site.page.keyboard.press("Space");
    await site.page.keyboard.press("Tab");
    assert.equal(await site.page.locator(".controls").getAttribute("data-phase"), "shown");
    await tickBy(site.page, 4500);
    assert.equal(await site.page.locator(".controls").getAttribute("data-phase"), "shown", "the keyboard's focus holds it");
    await site.page.keyboard.press("Escape");
    await tickBy(site.page, 400);
    assert.equal(await site.page.locator(".controls").getAttribute("data-phase"), "hidden");
    await site.context.close();
  });
});

