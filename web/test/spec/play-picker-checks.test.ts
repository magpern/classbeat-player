// The picker and the states around it (docs/design/play.md): pages of the website, so the website's
// measurable checks (site.md, S1 to S12) at 390, 768, 844 and 1024 px, on the fake backend: controls at
// least 44 px high, no sideways scroll, one h1 in one main, no hue. Writes a PNG of every shot to
// screenshots/play/ (CI keeps screenshots/ as an artefact for the Designer).
//   SPEC_ONLY=<regex>   only the shots whose name ("play-picker-390") matches
//   SPEC_JOBS=<n>       shots checked at the same time (default 4)
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { WEB_DIR, newPage } from "../lib/browser.ts";
import { PICKER_STATES } from "../lib/play-picker-states.ts";
import { launchOffline } from "../lib/site-fake.ts";
import { checkSiteShot } from "../lib/site-measure.ts";
import type { SiteResult, SiteShot } from "../lib/site-measure.ts";

const ONLY = process.env.SPEC_ONLY ? new RegExp(process.env.SPEC_ONLY) : null;
const JOBS = Number(process.env.SPEC_JOBS ?? 4);
const SHOT_DIR = join(WEB_DIR, "screenshots", "play");
const WIDTHS = [390, 768, 844, 1024];

const nameOf = (s: SiteShot): string => `play-${s.state.name}-${s.width}`;
const SHOTS: SiteShot[] = PICKER_STATES.flatMap((state) => WIDTHS.map((width) => ({ state, width, zoom: 1 as const, ink: true }))).filter((s) => !ONLY || ONLY.test(nameOf(s)));

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

describe("web player page: the picker and its states (site.md S1 to S12)", () => {
  let results: SiteResult[] = [];

  before(async () => {
    const browser: Browser = await launchOffline();
    mkdirSync(SHOT_DIR, { recursive: true });
    try {
      results = await pool(SHOTS, JOBS, async (s) => {
        const probe: Page = await newPage(browser, { width: 100, height: 100 });
        try {
          const r = await checkSiteShot(browser, probe, s);
          writeFileSync(join(SHOT_DIR, `${nameOf(s)}.png`), r.png);
          return r;
        } finally {
          await probe.context().close();
        }
      });
    } finally {
      await browser.close();
    }
  });

  it("has shots to check", () => {
    assert.ok(SHOTS.length > 0, "SPEC_ONLY matched no shot");
  });

  for (const s of SHOTS) {
    it(nameOf(s), () => {
      const r = results.find((x) => nameOf(x.shot) === nameOf(s));
      assert.ok(r, "the shot was not taken");
      assert.ok(r.rows.length > 0, "nothing was measured");
      assert.deepEqual(
        r.rows.filter((row) => row.result !== "ok").map((row) => `${row.check} "${row.text}": ${row.result}`),
        [],
      );
    });
  }
});
