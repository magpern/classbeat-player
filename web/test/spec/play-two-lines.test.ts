// Guard: the two-line allowance for a fact label and the pause line (docs/design/play.md, "Small
// landscape") belongs to the web player page's phone layouts only. In the player's own window (the room
// layout) the room-2d checks keep their one line, as before (room-checks.test.ts, C1 to C8).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { harnessUrl, launch, newPage, settle } from "../lib/browser.ts";
import { harness } from "../lib/play-drive.ts";
import { opened, started, tickBy } from "../lib/play-states.ts";

const SLOTS = ".facts .lbl, .bars.text";
/** The `data-lines` of each element that could take two lines: a fact label and the pause line. */
const linesOf = (page: Page): Promise<(string | null)[]> => page.locator(SLOTS).evaluateAll((els) => els.map((e) => e.getAttribute("data-lines")));

describe("the room layout keeps one line for a fact label and the pause line", () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(async () => {
    await browser.close();
  });

  for (const [fixture, size] of [["before-start", [1920, 1080]], ["finished", [1280, 720]], ["paused", [1920, 1080]], ["paused", [1024, 768]]] as const) {
    it(`${fixture} at ${size[0]}x${size[1]}: no element of the room is allowed a second line`, async () => {
      const page = await newPage(browser, { width: size[0], height: size[1] });
      await page.goto(harnessUrl(fixture));
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      const lines = await linesOf(page);
      assert.ok(lines.length > 0, "nothing to check: the fixture shows neither a fact label nor the pause line");
      assert.deepEqual(lines.filter((l) => l !== null), []);
      await page.context().close();
    });
  }
});

describe("the phone layouts of the web player page allow two lines for them", () => {
  const { open } = harness();

  it("a fact label before the start, and the pause line while paused, in portrait and on the side", async () => {
    for (const size of [[390, 844], [844, 390]] as const) {
      const site = await open({ size });
      await opened(site.page);
      const facts = await linesOf(site.page);
      assert.ok(facts.length > 0);
      assert.deepEqual([...new Set(facts)], ["2"], `fact labels at ${size}`);
      await started(site.page);
      await site.page.keyboard.press("Space");
      await tickBy(site.page, 200);
      const pause = await site.page.locator(".bars.text").evaluateAll((els) => els.map((e) => e.getAttribute("data-lines")));
      assert.deepEqual(pause, ["2"], `the pause line at ${size}`);
      await site.context.close();
    }
  });
});
