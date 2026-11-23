// Motion on the plain screen (docs/design/system.md, Motion; room-2d.md, "Motion and reduced motion"): every
// change is a step on a frame mark. No transition, no animation, no beat dot, no edge line, no frame loop;
// the gel's colour is cut in the change frame; the score steps with the countdown's tick; a pattern's count
// steps on its ticks. The screen is the same with reduced motion (the system's or the player's own).
// The measure itself is room-s6.test.ts; the marks' placement is test/unit/mark-gate.test.ts.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import type { Scenario } from "../../src/fixtures/timeline.ts";
import { harnessUrl, launch, newPage, settle } from "../lib/browser.ts";

let browser: Browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser.close();
});

type Mode = "off" | "system" | "setting";

/** The room playing `scenario` on a stepped clock, as the S6 checks do. */
async function play(scenario: Scenario, mode: Mode = "off"): Promise<Page> {
  const page = await newPage(browser, { width: 1280, height: 720, reducedMotion: mode === "system" });
  await page.goto(harnessUrl("running", "virtual=1"));
  await page.evaluate(({ s, r }) => window.drive.begin(s, r), { s: scenario, r: mode === "setting" });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  await page.evaluate(() => window.drive.reset());
  return page;
}

/** Steps to the next changed frame; what the screen is at that frame, read by `read`. */
async function nextMark<T>(page: Page, read: () => T): Promise<{ ms: number; value: T } | null> {
  const stop = await page.evaluate(() => window.drive.advance(60 * 60));
  return stop === null ? null : { ms: stop.ms, value: await page.evaluate(read) };
}

const CHANGE = { fixture: "running", startMs: 1_160_000, events: [] } as const satisfies Scenario;
const gel = (): { bg: string; edge: number; num: string | null } => {
  const g = document.querySelector(".gel") as HTMLElement;
  return { bg: getComputedStyle(g).backgroundColor, edge: g.querySelectorAll(".edge").length, num: g.querySelector(".gel-num")?.textContent ?? null };
};

for (const mode of ["off", "system", "setting"] as const) {
  describe(`the interval change (reduced motion: ${mode})`, () => {
    it("cuts the gel's colour in one frame: no mix, no white line, nothing animating", async () => {
      const page = await play(CHANGE, mode);
      const before = await page.evaluate(gel);
      let change: { ms: number; value: ReturnType<typeof gel> } | null = null;
      for (let m = await nextMark(page, gel); m !== null && change === null; m = await nextMark(page, gel)) {
        assert.deepEqual(await page.evaluate(() => window.drive.moving()), [], "a transition or animation is on the page");
        if (m.value.bg !== before.bg) change = m;
      }
      assert.ok(change, "the gel never changed colour");
      // The change frame is the interval's end, 9 s in, and its colour is the new zone's in that very frame.
      assert.ok(Math.abs(change.ms - 9000) < 20, `at ${change.ms} ms`);
      assert.equal(change.value.num, "2");
      assert.equal(change.value.edge, 0, "no edge line");
      await page.context().close();
    });

    it("has no beat dot", async () => {
      const page = await play({ fixture: "running", startMs: 1_099_000, events: [] }, mode);
      for (let i = 0; i < 3; i += 1) {
        await nextMark(page, () => 0);
        assert.equal(await page.locator(".beat").count(), 0);
      }
      await page.context().close();
    });
  });
}

describe("the score", () => {
  it("steps with the countdown's tick: 0.22 vw a second, never between, with or without reduced motion", async () => {
    for (const mode of ["off", "setting"] as const) {
      const page = await play({ fixture: "running", startMs: 1_099_000, events: [] }, mode);
      const left = (): { left: number; shift: string } => {
        const first = document.querySelector(".score .track.iv .block:not(.gone)") as HTMLElement;
        return { left: parseFloat(first.style.left), shift: (document.querySelector(".score .scroll") as HTMLElement).style.transform };
      };
      let prev = await page.evaluate(left);
      let prevMs = 0;
      for (let i = 0; i < 6; i += 1) {
        const m = await nextMark(page, left);
        assert.ok(m);
        assert.equal(m.value.shift, "", "the strip is never moved by a transform");
        const dt = (m.ms - prevMs) / 1000;
        assert.ok(Math.abs(prev.left - m.value.left - 0.22 * dt) < 0.03, `moved ${(prev.left - m.value.left).toFixed(3)} vw in ${dt.toFixed(2)} s`);
        [prev, prevMs] = [m.value, m.ms];
      }
      await page.context().close();
    }
  });

  it("does not move while paused", async () => {
    const page = await play({ fixture: "paused", events: [] });
    assert.equal(await page.evaluate(() => window.drive.advance(60 * 5)), null, "a paused screen with nothing happening never changes");
    await page.context().close();
  });
});

describe("a pattern's count (room-2d.md: it is information, not decoration)", () => {
  const count = (): string | null => document.querySelector(".pv .cnt")?.textContent ?? null;

  for (const mode of ["off", "system", "setting"] as const) {
    it(`steps on its ticks, at least 500 ms apart, one beat at a time at 60 bpm (reduced motion: ${mode})`, async () => {
      const page = await play({ fixture: "pattern", startMs: 1_099_000, bpm: 60, events: [] }, mode);
      const seen: { ms: number; count: string | null }[] = [];
      for (let m = await nextMark(page, count); m !== null && seen.length < 8; m = await nextMark(page, count)) seen.push({ ms: m.ms, count: m.value });
      assert.deepEqual(seen.map((s) => s.count), ["3", "2", "1", "8", "7", "6", "5", "4"]);
      for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i].ms - seen[i - 1].ms >= 500, "ticks at least 500 ms apart");
      // Nothing about it animates or transitions, and there is no dot beside it.
      assert.deepEqual(await page.evaluate(() => window.drive.moving()), []);
      assert.equal(await page.locator(".beat").count(), 0);
      await page.context().close();
    });
  }

  it("gives its cadence way to the cap above 120 bpm: at most two marks a second at 200 bpm", async () => {
    const page = await play({ fixture: "pattern", startMs: 1_099_000, bpm: 200, events: [] });
    const marks: number[] = [];
    for (let m = await nextMark(page, count); m !== null && marks.length < 16; m = await nextMark(page, count)) marks.push(m.ms);
    for (const t of marks) assert.ok(marks.filter((x) => x >= t && x < t + 1000 - 1e-6).length <= 2);
    await page.context().close();
  });
});
