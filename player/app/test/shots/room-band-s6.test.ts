// The control band and the join sheet under the strict S6 measure (room-2d.md, "Motion and reduced motion: the flash
// budget on the plain screen (S6)"; issue #585), on the real room page in headless Chrome with Playwright's paused
// clock: the band goes within 500 ms after its 3 s in every state, any two marks are at least 500 ms apart, and
// nothing on the band or the sheet runs (no transition, no animation).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { launchChrome } from "./page.ts";
import { frameOf, on, openRoom, ROUTES, wiggle } from "./room-page.ts";
import type { RoomOpen, RoomOpenOptions } from "./room-page.ts";

let browser: Browser;
before(async () => {
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

const SIZE: readonly [number, number] = [1920, 1080];

async function room(o: Partial<RoomOpenOptions>, body: (r: RoomOpen) => Promise<void>): Promise<void> {
  const r = await openRoom(browser, { size: SIZE, frame: frameOf("running", ROUTES.following), remote: on(1), ...o });
  try {
    await body(r);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.external, []);
  } finally {
    await r.close();
  }
}

test("with two displays the band goes within 500 ms after its 3 s in paused, before the start and finished, where no tick comes", async () => {
  for (const fixture of ["paused", "before-start", "finished"]) {
    await room({ frame: frameOf(fixture), alone: false, remote: { slot: "absent" } }, async (r) => {
      await wiggle(r.page);
      assert.equal(await r.phase(), "shown", fixture);
      await r.run(2950);
      assert.equal(await r.phase(), "shown", fixture);
      await r.run(550);
      assert.equal(await r.phase(), "hidden", `${fixture}: gone by 3 s + 500 ms`);
    });
  }
});

test("a mark placed just before the 3 s ends keeps the band up until 500 ms after it, and no longer", async () => {
  await room({}, async (r) => {
    await wiggle(r.page);
    await r.run(2900);
    // The slot's state line changes in a frame of its own, 100 ms before the band is due to go.
    await r.pushRemote(on(2));
    assert.equal(await r.phase(), "shown");
    await r.run(200);
    assert.equal(await r.phase(), "shown", "the band's own mark waits for the 500 ms gap");
    await r.run(450);
    assert.equal(await r.phase(), "hidden", "at most 500 ms after its 3 s");
  });
});

test("nothing on the band or the sheet runs: no transition and no animation, hidden, shown, asking or with the sheet up", async () => {
  const running = (r: RoomOpen): Promise<string[]> =>
    r.page.evaluate(() =>
      [...document.querySelectorAll(".band, .band *, section.join, section.join *")]
        .filter((e) => {
          const cs = getComputedStyle(e);
          const moving = (list: string): boolean => list.split(",").some((d) => parseFloat(d) !== 0);
          return moving(cs.transitionDuration) || moving(cs.animationDuration) || cs.animationName !== "none";
        })
        .map((e) => e.className.toString() || e.tagName),
    );
  for (const reducedMotion of [false, true]) {
    await room({ reducedMotion }, async (r) => {
      assert.deepEqual(await running(r), [], "hidden");
      await wiggle(r.page);
      assert.deepEqual(await running(r), [], "shown");
      await r.page.keyboard.press("End");
      assert.deepEqual(await running(r), [], "asking");
    });
    await room({ frame: frameOf("before-start"), reducedMotion }, async (r) => {
      assert.equal(await r.page.isVisible("section.join"), true);
      assert.deepEqual(await running(r), [], `the sheet up, reduced motion ${reducedMotion}`);
    });
  }
});

test("the sheet and the band each appear in one frame: the first frame they are in the page, they are at full opacity", async () => {
  await room({ frame: frameOf("before-start") }, async (r) => {
    const opacity = await r.page.evaluate(() => {
      const q = (s: string): number => Number(getComputedStyle(document.querySelector(s)!).opacity);
      return { join: q("section.join"), band: q(".band") };
    });
    assert.deepEqual(opacity, { join: 1, band: 1 });
  });
});
