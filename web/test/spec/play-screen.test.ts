// Keep-awake and full screen on the web player page (ADR 0008, section 5; docs/design/play.md, "Keep-awake",
// "Full screen"), on the fake site with stand-ins for the Screen Wake Lock and Fullscreen APIs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Page } from "playwright-core";
import { countdown, harness, link, text } from "../lib/play-drive.ts";
import { BASE_DOC, WAKE_REFUSED, opened, started, tickBy } from "../lib/play-states.ts";

const { open } = harness();

describe("keep-awake", () => {
  /** A wake lock that grants, and counts what the page asked and let go of. */
  const GRANTED = `window.__wake = { asked: 0, released: 0 };
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => { window.__wake.asked += 1; const l = {}; let on = true;
      return Promise.resolve({ get released() { return !on; }, release() { on = false; window.__wake.released += 1; return Promise.resolve(); }, addEventListener(t, f) { l[t] = f; } }); } } });`;
  const wake = (page: Page): Promise<{ asked: number; released: number }> => page.evaluate(() => (window as unknown as { __wake: { asked: number; released: number } }).__wake);

  it("is asked for at Start, held through a pause and a resume, and released at the end of the class", async () => {
    const site = await open({ before: GRANTED });
    await opened(site.page);
    assert.deepEqual(await wake(site.page), { asked: 0, released: 0 }, "not before Start");
    await started(site.page);
    assert.deepEqual(await wake(site.page), { asked: 1, released: 0 });
    await site.page.keyboard.press("Space");
    await site.page.keyboard.press("Space");
    await tickBy(site.page, 100);
    assert.deepEqual(await wake(site.page), { asked: 1, released: 0 }, "held through a pause: nothing to ask again");
    assert.equal(await link(site.page), "Manual clock");
    await site.page.clock.fastForward(BASE_DOC.class.length_ms);
    await tickBy(site.page, 500);
    assert.deepEqual(await wake(site.page), { asked: 1, released: 1 }, "released at Class Complete");
    await site.context.close();
  });

  it("is released at End class and when the page is hidden, and asked for again when it is shown", async () => {
    const site = await open({ before: GRANTED });
    await started(site.page);
    await site.page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.deepEqual(await wake(site.page), { asked: 1, released: 1 }, "released when hidden");
    await site.page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await tickBy(site.page, 100);
    assert.deepEqual(await wake(site.page), { asked: 2, released: 1 }, "asked for again when shown");
    await site.page.keyboard.press("End");
    await site.page.click('[data-action="end-class"]');
    await site.page.waitForSelector(".rows .row, .plate, .btns a");
    assert.deepEqual(await wake(site.page), { asked: 2, released: 2 }, "released at End class");
    await site.context.close();
  });

  it("says 'Screen may turn off' for as long as it is refused, asks again on Resume, and says Manual clock once it is granted", async () => {
    // The first request is refused, the next granted.
    const site = await open({
      before: `window.__asks = 0; Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => { window.__asks += 1; return window.__asks === 1 ? Promise.reject(new DOMException("no", "NotAllowedError")) : Promise.resolve({ released: false, release() { return Promise.resolve(); }, addEventListener() {} }); } } });`,
    });
    await started(site.page);
    assert.equal(await link(site.page), "Screen may turn off");
    assert.equal(await site.page.locator(".rail .link").evaluate((e) => e.className.includes("manual") && e.className.includes("handover")), true, "white, with the square");
    await site.page.keyboard.press("Space");
    await tickBy(site.page, 100);
    assert.equal(await link(site.page), "Screen may turn off", "still refused while paused");
    await site.page.keyboard.press("Space");
    await tickBy(site.page, 100);
    assert.equal(await site.page.evaluate(() => (window as unknown as { __asks: number }).__asks), 2, "asked again on Resume");
    assert.equal(await link(site.page), "Manual clock");
    assert.ok((await countdown(site.page)).length > 0, "the class ran on throughout");
    await site.context.close();
  });

  it("a browser with no wake lock says the same one line, and the class runs", async () => {
    const site = await open({ before: `Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });` });
    await started(site.page);
    assert.equal(await link(site.page), "Screen may turn off");
    assert.equal(await text(site.page, ".gel-name"), "Recovery");
    await site.context.close();
  });

  it("a refusal is shown once in the slot and nowhere else", async () => {
    const site = await open({ before: WAKE_REFUSED });
    await started(site.page);
    assert.equal(await site.page.getByText("Screen may turn off").count(), 1);
    await site.context.close();
  });
});


describe("full screen", () => {
  const STAND_IN = (enabled: boolean): string => `window.__fs = 0; Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: ${enabled} });
    Element.prototype.requestFullscreen = function () { window.__fs += 1; return Promise.resolve(); };`;
  const asked = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __fs: number }).__fs);

  it("is asked for at Start where the browser has it, and not again on Resume", async () => {
    const site = await open({ before: STAND_IN(true) });
    await opened(site.page);
    assert.equal(await asked(site.page), 0);
    await started(site.page);
    assert.equal(await asked(site.page), 1);
    await site.page.keyboard.press("Space");
    await site.page.keyboard.press("Space");
    assert.equal(await asked(site.page), 1, "leaving full screen is the person's choice");
    await site.context.close();
  });

  it("says nothing where the browser has none: the page fills the screen and the link slot says Manual clock", async () => {
    const site = await open({ before: STAND_IN(false), size: [390, 664] });
    await started(site.page);
    assert.equal(await asked(site.page), 0);
    assert.equal(await link(site.page), "Manual clock");
    assert.equal(await site.page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, "one screen, no scroll");
    await site.context.close();
  });
});

