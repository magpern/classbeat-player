// The cue box and the next row's second line (docs/design/room-2d.md, "Fitting text", "Cue" and
// "Next row"). The cue box holds two lines at --t-text or three at --t-text-min (two, then a third
// as `.three`, at 3:2 and narrower); a cue that needs more takes the next row's second line, the
// next cue, for that interval: wider than 3:2 a fourth line (`.four`, the next row one line at
// 73.2 vh); at 3:2 and narrower a third line (`.three`, one line at 76.5 vh) and a fourth (`.four`,
// the next row short, beside the gel's foot).
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
    const line = next.querySelector(".nline") as HTMLElement;
    const ncue = next.querySelector(".ncue") as HTMLElement | null;
    const shown = [...line.children].filter((c) => getComputedStyle(c).display !== "none").map((c) => c.textContent);
    const lines = Math.round(cue.scrollHeight / parseFloat(getComputedStyle(cue).lineHeight));
    return {
      four: cue.classList.contains("four"),
      three: cue.classList.contains("three"),
      long: cue.classList.contains("long"),
      lines,
      cueTop: cue.getBoundingClientRect().top / innerHeight,
      nextTop: next.getBoundingClientRect().top / innerHeight,
      shown,
      ncue: ncue ? getComputedStyle(ncue).display !== "none" : null,
    };
  });
  await page.context().close();
  return r;
}

describe("the four-line cue at 3:2 and narrower", () => {
  it("keeps a short next row beside the gel's foot and starts the cue at 63.4 vh", async () => {
    const r = await probe("worst-cue-caps", 1280, 1024);
    assert.equal(r.four, true);
    assert.ok(Math.abs(r.cueTop - 0.634) < 0.01, `cue at ${r.cueTop}`);
    assert.ok(Math.abs(r.nextTop - 0.58) < 0.01, `next row at ${r.nextTop}`);
    assert.equal(r.shown.length, 4, r.shown.join("|")); // Next, chip, name, length
    assert.equal(r.ncue, false, "the next cue is left out");
  });

  it("does nothing for an ordinary cue", async () => {
    const r = await probe("running", 1280, 1024);
    assert.deepEqual([r.four, r.three, r.long], [false, false, false]);
  });
});

describe("the next row's second line", () => {
  it("is the next interval's cue, under line 1, at every layout, for an ordinary cue", async () => {
    for (const [w, h, top] of [[1920, 1080, 0.69], [1650, 1080, 0.69], [1440, 1080, 0.725], [1280, 1024, 0.725]] as const) {
      const r = await probe("running", w, h);
      assert.equal(r.ncue, true, `${w}x${h}: the next cue shows`);
      assert.ok(Math.abs(r.nextTop - top) < 0.01, `${w}x${h}: next row at ${r.nextTop}`);
      assert.equal(r.lines, 2, `${w}x${h}: a two-line cue`);
    }
  });

  it("is left out for a three-line cue at 3:2 and narrower: the next row is one line at 76.5 vh", async () => {
    const r = await probe("worst-pattern", 1440, 1080);
    assert.deepEqual([r.three, r.four, r.long, r.lines], [true, false, true, 3]);
    assert.equal(r.ncue, false);
    assert.ok(Math.abs(r.nextTop - 0.765) < 0.01, `next row at ${r.nextTop}`);
    assert.equal(r.shown.length, 5, r.shown.join("|")); // Next, chip, name, length, and the wrapper of cadence and position
  });

  it("holds a three-line cue wider than 3:2 with the next cue kept", async () => {
    const r = await probe("worst-pattern", 1920, 1080);
    assert.deepEqual([r.three, r.four, r.long], [false, false, true]);
    assert.equal(r.ncue, true);
  });

  it("is left out for a fourth line wider than 3:2: the next row is one line at 73.2 vh", async () => {
    const r = await probe("worst-pattern-four", 1650, 1080);
    assert.deepEqual([r.four, r.lines], [true, 4]);
    assert.equal(r.ncue, false);
    assert.ok(Math.abs(r.nextTop - 0.732) < 0.01, `next row at ${r.nextTop}`);
  });
});
