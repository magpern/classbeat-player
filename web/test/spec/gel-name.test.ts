// The zone name's size (room-2d.md, "Zone name on the gel"): a name that fits is at the full size,
// and the same name is the same size in running, hold and paused, at every size, on every load.
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

const SIZES: readonly (readonly [number, number])[] = [[1920, 1080], [1680, 1050], [1440, 1080]];

async function nameSize(fixture: string, w: number, h: number, throttle: number): Promise<{ px: number; expected: number; text: string }> {
  const page = await newPage(browser, { width: w, height: h });
  // A slow machine loads the fonts late: the name must be measured with the real fonts.
  if (throttle > 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await page.goto(harnessUrl(fixture, ""));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => {
    const name = document.querySelector(".gel-name") as HTMLElement;
    return { px: parseFloat(getComputedStyle(name).fontSize), text: name.textContent ?? "", vw: innerWidth, vh: innerHeight };
  });
  await page.context().close();
  // --t-value is 8.4 vh, at most 5 vw (5.75 vw at 3:2 and narrower).
  const narrow = r.vw / r.vh <= 1.5;
  return { px: r.px, text: r.text, expected: Math.min(0.084 * r.vh, (narrow ? 0.0575 : 0.05) * r.vw) };
}

describe("the zone name's size", () => {
  for (const [w, h] of SIZES) {
    it(`"Threshold" is at the full size, the same in running, hold and paused (${w}x${h}), on every load`, async () => {
      for (let load = 0; load < 3; load += 1) {
        for (const fixture of ["running", "hold", "paused"]) {
          const r = await nameSize(fixture, w, h, load === 0 ? 1 : load * 6);
          assert.equal(r.text, "Threshold");
          assert.ok(Math.abs(r.px - r.expected) < 0.6, `${fixture} ${w}x${h} load ${load}: ${r.px}px, expected ${r.expected.toFixed(1)}px`);
        }
      }
    });
  }
});
