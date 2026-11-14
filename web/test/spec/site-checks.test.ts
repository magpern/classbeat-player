// The website's measurable checks (docs/design/site.md, S1 to S12) on the real pages, in Chrome,
// on the fake backend: every state at the phone and desktop sizes, the main states also at the
// tablet size and at 320 px, and every state's reflow at 200 % text (S9). Writes a PNG of every
// shot to screenshots/site/ (CI keeps them with the room screen's for the Designer).
//   SPEC_ONLY=<regex>   only the shots whose name ("site-sign-in-390") matches
//   SPEC_JOBS=<n>       shots checked at the same time (default 4)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, before, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { WEB_DIR, newPage } from "../lib/browser.ts";
import { launchOffline } from "../lib/site-fake.ts";
import { checkSiteShot } from "../lib/site-measure.ts";
import type { SiteResult } from "../lib/site-measure.ts";
import { siteShotName, siteShots } from "../lib/site-shots.ts";
import type { SiteShot } from "../lib/site-shots.ts";
import { STATES } from "../lib/site-states.ts";

const ONLY = process.env.SPEC_ONLY ? new RegExp(process.env.SPEC_ONLY) : null;
const JOBS = Number(process.env.SPEC_JOBS ?? 4);
const SHOT_DIR = join(WEB_DIR, "screenshots", "site");

const SHOTS: SiteShot[] = siteShots(STATES).filter((s) => !ONLY || ONLY.test(siteShotName(s)));

async function pool<T, R>(items: readonly T[], n: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await work(items[i]);
    }),
  );
  return out;
}

describe("website: the spec's measurable checks (site.md S1 to S12)", () => {
  let results: SiteResult[] = [];

  before(async () => {
    const browser: Browser = await launchOffline();
    mkdirSync(SHOT_DIR, { recursive: true });
    try {
      results = await pool(SHOTS, JOBS, async (s) => {
        const probe: Page = await newPage(browser, { width: 100, height: 100 });
        try {
          const r = await checkSiteShot(browser, probe, s);
          writeFileSync(join(SHOT_DIR, `${siteShotName(s)}.png`), r.png);
          return r;
        } finally {
          await probe.context().close();
        }
      });
    } finally {
      await browser.close();
    }
    const failed = results.filter((r) => r.rows.some((x) => x.result !== "ok")).map((r) => siteShotName(r.shot));
    console.log(`\nwebsite: ${results.length} shots, ${failed.length} failing${failed.length ? `: ${failed.join(", ")}` : ""}\n`);
  });

  it("has shots to check", () => {
    assert.ok(SHOTS.length > 0, "SPEC_ONLY matched no shot");
  });

  it("covers every state in the table", () => {
    if (ONLY) return;
    for (const s of STATES) assert.ok(results.some((r) => r.shot.state.name === s.name && r.shot.zoom === 1), s.name);
  });

  for (const s of SHOTS) {
    it(siteShotName(s), () => {
      const r = results.find((x) => siteShotName(x.shot) === siteShotName(s));
      assert.ok(r, "the shot was not taken");
      assert.ok(r.rows.length > 0, "nothing was measured");
      assert.deepEqual(
        r.rows.filter((row) => row.result !== "ok").map((row) => `${row.check} "${row.text}": ${row.result}`),
        [],
      );
    });
  }
});
