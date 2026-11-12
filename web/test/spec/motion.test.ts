// Motion (docs/design/system.md, Motion; room-2d.md, "Motion and reduced motion"): the interval
// change is the one orchestrated moment; the score moves continuously (in whole seconds with
// reduced motion); nothing flashes more than three times a second; reduced motion zeroes it all.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { harnessUrl, launch, newPage } from "../lib/browser.ts";

let browser: Browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser.close();
});

async function open(fixture: string, o: { media?: boolean; setting?: boolean } = {}): Promise<Page> {
  const page = await newPage(browser, { width: 1280, height: 720, reducedMotion: o.media });
  await page.goto(harnessUrl(fixture, o.setting ? "reduced=1" : ""));
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const shift = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const t = (document.querySelector(".score .scroll") as HTMLElement).style.transform;
    return t ? -parseFloat(t.replace("translateX(", "")) : 0;
  });

describe("the interval change", () => {
  it("is not animated at start-up: the first draw is not a change", async () => {
    const page = await open("running");
    assert.equal(await page.locator(".gel .edge.go").count(), 0);
    await page.context().close();
  });

  it("crosses the gel's colour in 700 ms and runs a white line down its edge for 160 ms", async () => {
    const page = await open("running");
    await page.evaluate(() => window.harness.show("last-interval"));
    const m = await page.evaluate(() => {
      const gel = getComputedStyle(document.querySelector(".gel") as Element);
      const edge = getComputedStyle(document.querySelector(".gel .edge") as Element);
      return { gel: gel.transitionDuration, edge: edge.animationDuration, name: edge.animationName, edgeColour: edge.backgroundColor };
    });
    assert.match(m.gel, /0\.7s/);
    assert.equal(m.edge, "0.16s");
    assert.equal(m.name, "edge");
    assert.match(m.edgeColour, /^rgb\(246, 244, 239\)$/, "white, never a hue");
    await page.context().close();
  });

  for (const how of ["system", "setting"] as const) {
    it(`is instant with reduced motion (${how === "system" ? "the system's preference" : "the player's own setting"})`, async () => {
      const page = await open("running", how === "system" ? { media: true } : { setting: true });
      await page.evaluate(() => window.harness.show("last-interval"));
      const m = await page.evaluate(() => ({
        gel: getComputedStyle(document.querySelector(".gel") as Element).transitionDuration,
        edge: getComputedStyle(document.querySelector(".gel .edge") as Element).animationDuration,
      }));
      assert.ok(m.gel.split(",").every((d) => parseFloat(d) === 0), m.gel);
      assert.ok(m.edge.split(",").every((d) => parseFloat(d) === 0), m.edge);
      await page.context().close();
    });
  }
});

describe("the score", () => {
  it("moves continuously while the clock runs", async () => {
    const page = await open("running");
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await page.waitForTimeout(120);
      samples.push(await shift(page));
    }
    assert.ok(samples.every((v, i) => i === 0 || v > samples[i - 1]), `not increasing: ${samples.join(", ")}`);
    await page.context().close();
  });

  it("steps once a second with reduced motion", async () => {
    const page = await open("running", { setting: true });
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await page.waitForTimeout(120);
      samples.push(await shift(page));
    }
    // Five samples over 0.6 s: at most one step, and every value is a whole number of seconds.
    assert.ok(new Set(samples).size <= 2, `moved in between steps: ${samples.join(", ")}`);
    for (const v of samples) assert.ok(Math.abs(v / (100 / 360) - Math.round(v / (100 / 360))) < 1e-6, `${v} is not whole seconds`);
    await page.context().close();
  });

  it("stands still while paused", async () => {
    const page = await open("paused");
    await page.waitForTimeout(300);
    assert.equal(await shift(page), 0);
    await page.context().close();
  });
});

describe("the beat dot", () => {
  it("flashes at most three times a second, at a slow tempo and at 200 bpm", async () => {
    for (const fixture of ["running", "worst-running"]) {
      const page = await open(fixture);
      const periods = await page.evaluate(() => document.getAnimations().map((a) => Number(a.effect?.getComputedTiming().duration)));
      assert.ok(periods.length >= 1, `${fixture}: no beat animation`);
      for (const p of periods) assert.ok(1000 / p <= 3, `${fixture}: flashes ${(1000 / p).toFixed(2)} times a second`);
      await page.context().close();
    }
  });

  it("is not made at all with reduced motion, nor while the link is not locked", async () => {
    const reduced = await open("running", { setting: true });
    assert.equal(await reduced.locator(".beat").count(), 0);
    await reduced.context().close();
    for (const fixture of ["paused", "coasting", "off-list", "manual"]) {
      const page = await open(fixture);
      assert.equal(await page.locator(".beat").count(), 0, fixture);
      await page.context().close();
    }
    const locked = await open("running");
    assert.equal(await locked.locator(".beat").count(), 1);
    await locked.context().close();
  });
});
