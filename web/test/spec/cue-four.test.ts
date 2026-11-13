// A cue that needs a fourth line at 3:2 and narrower takes the next row's place: the next row stays
// (zone chip, name, length) but is short, and moves up beside the foot of the gel (room-2d.md).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { harnessUrl, launch, newPage } from "../lib/browser.ts";

let browser: Browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser.close();
});

async function probe(fixture: string, w: number, h: number) {
  const page = await newPage(browser, { width: w, height: h });
  await page.goto(harnessUrl(fixture));
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(() => {
    const cue = document.querySelector(".cue") as HTMLElement;
    const next = document.querySelector(".next") as HTMLElement;
    const shown = [...next.children].filter((c) => getComputedStyle(c).display !== "none").map((c) => c.textContent);
    return { four: cue.classList.contains("four"), cueTop: cue.getBoundingClientRect().top / innerHeight, nextTop: next.getBoundingClientRect().top / innerHeight, shown };
  });
  await page.context().close();
  return r;
}

describe("the four-line cue at 3:2 and narrower", () => {
  it("keeps a short next row beside the gel's foot and starts the cue at 62.8 vh", async () => {
    const r = await probe("worst-cue-caps", 1280, 1024);
    assert.equal(r.four, true);
    assert.ok(Math.abs(r.cueTop - 0.628) < 0.01, `cue at ${r.cueTop}`);
    assert.ok(r.nextTop < 0.6, `next row at ${r.nextTop}`);
    assert.deepEqual(r.shown.length, 4, r.shown.join("|")); // Next, chip, name, length
  });

  it("does nothing for an ordinary cue, or in the wide layout", async () => {
    assert.equal((await probe("running", 1280, 1024)).four, false);
    assert.equal((await probe("worst-cue-caps", 1920, 1080)).four, false);
  });
});
