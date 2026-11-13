// The companion's measurable checks (docs/design/companion.md, K1 to K10) on the real page, in
// Chrome, on a page the fake has already brought to a state. Reuses the room screen's ink and hue
// measurement (measure.ts, page/collect.js, page/ink.js) with the companion's own floors: cap
// height as a share of the viewport height per orientation and a floor in CSS pixels (K1), 7 : 1
// for every text (K2), and the page checks of page/companion-checks.js (K4 to K6).
//
// The page's clock is paused (Playwright's clock), so no animation frame runs: a style change is
// flushed by reading the layout, and the screenshot paints it.
import type { Page } from "playwright-core";
import collect from "../spec/page/collect.js";
import pageChecks, { CONTRAST, FLOORS } from "../spec/page/companion-checks.js";
import { HIDE, inkOf, shadowHues } from "./measure.ts";
import type { Row } from "./measure.ts";

const flush = (page: Page): Promise<void> => page.evaluate(() => void document.body.getBoundingClientRect());

export interface CompanionResult {
  readonly rows: Row[];
  readonly png: Buffer;
}

/** K9: with reduced motion, no transition or animation lasts longer than 0; nothing repeats faster than three times a second. */
async function motion(page: Page): Promise<Row[]> {
  const fast = await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((el) => {
        const c = getComputedStyle(el);
        if (c.animationName === "none" || !c.animationIterationCount.includes("infinite")) return false;
        return c.animationDuration.split(",").some((d) => parseFloat(d) * (d.trim().endsWith("ms") ? 0.001 : 1) < 1 / 3);
      })
      .map((el) => String(el.className || el.tagName)),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  const moving = await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((el) => {
        const c = getComputedStyle(el);
        const long = (v: string): boolean => v.split(",").some((d) => parseFloat(d) > 0);
        return long(c.transitionDuration) || (c.animationName !== "none" && long(c.animationDuration));
      })
      .map((el) => String(el.className || el.tagName)),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  return [
    { tier: "motion", text: "at most 3 flashes a second", result: fast.length ? `FAIL repeats faster: ${fast.join(", ")}` : "ok" },
    { tier: "motion", text: "reduced motion", result: moving.length ? `FAIL still moves: ${moving.join(", ")}` : "ok" },
  ];
}

export async function checkCompanion(page: Page, probe: Page, width: number, height: number): Promise<CompanionResult> {
  await page.evaluate(() => document.fonts.ready);
  await flush(page);
  const png = await page.screenshot();
  const { items, zones, hues, loose } = await page.evaluate(collect);
  const pageRows = await page.evaluate(pageChecks);
  // A constructed sheet: the page's CSP refuses an added <style>, as it should. Corners are
  // squared while the ink is measured (the kept screenshot above is the real page): Chromium
  // re-rasterises an anti-aliased rounded corner between two shots, and the ink diff would take
  // those corner pixels for text on the black outside the corner.
  await page.evaluate((css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, `${HIDE} * { border-radius: 0 !important; }`);
  for (const it of items) {
    const r = await inkOf(page, probe, { width, height }, it, flush);
    it.ink = r?.box ?? null;
    it.worst = r ? r.worst : Infinity;
  }
  await page.evaluate(() => void (document.adoptedStyleSheets = document.adoptedStyleSheets.slice(0, -1)));
  const land = width > height;
  const rows: Row[] = items.length ? [] : [{ tier: "text", text: "(none)", result: "FAIL no text was measured" }];
  for (const it of items) {
    const floor = FLOORS[it.tier];
    const problems = [...it.problems];
    const k = it.ink;
    if (!floor) problems.push(`unknown tier ${it.tier}`);
    else if (!k) problems.push("no visible ink");
    else {
      const [portrait, landscape, px] = floor;
      const share = land ? landscape : portrait;
      if (it.cap < share - 0.00005) problems.push(`cap ${(it.cap * 100).toFixed(2)}% < ${(share * 100).toFixed(1)}%`);
      if (it.cap * height < px - 0.05) problems.push(`cap ${(it.cap * height).toFixed(1)} px < ${px} px`);
      if ((it.worst ?? Infinity) < CONTRAST) problems.push(`contrast ${(it.worst ?? 0).toFixed(1)} < ${CONTRAST} in ink ${[k.x0, k.y0, k.x1, k.y1].map(Math.round).join(",")}`);
      for (const o of items) {
        if (o === it || !o.ink || it.anc.includes(o.i)) continue;
        const b = o.ink;
        if (k.x0 < b.x1 && b.x0 < k.x1 && k.y0 < b.y1 && b.y0 < k.y1) problems.push(`overlaps "${o.text}"`);
      }
    }
    rows.push({ tier: it.tier, text: it.text, result: problems.length ? `FAIL ${problems.join("; ")}` : "ok" });
  }
  for (const z of zones) {
    const problems: string[] = [];
    if (z.z !== "-" && z.num !== z.z) problems.push(`number "${z.num}" is not ${z.z}`);
    if (z.problem) problems.push(z.problem);
    rows.push({ tier: "zone", text: `zone ${z.z} ${z.name}`.slice(0, 30), result: problems.length ? `FAIL ${problems.join("; ")}` : "ok" });
  }
  for (const t of loose) rows.push({ tier: "text", text: t, result: "FAIL text outside any data-tier element (K10)" });
  for (const h of [...hues, ...(await shadowHues(page))]) rows.push({ tier: "hue", text: h.slice(0, 40), result: "FAIL hue outside a zone (K8)" });
  for (const [text, result] of pageRows) rows.push({ tier: "companion", text, result });
  rows.push(...(await motion(page)));
  return { rows, png };
}
