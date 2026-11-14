// The web player page's measurable checks (docs/design/play.md, P1 to P10) on the real page, in
// Chrome, on the fake site with a paused clock. Ink and hue are measured as the room screen's checks
// and the companion's do (page/collect.js, page/ink.js, border-walk.ts); the floors are the room's
// (room-2d.md, C1) on a tablet in landscape and the handlebar companion's (companion.md, K1) on a
// phone or in portrait, with 7 : 1 for every text on a phone.
//
// The page's clock is paused (Playwright's clock), so no animation frame runs: a style change is
// flushed by reading the layout, and the screenshot paints it.
import type { Page } from "playwright-core";
import { layoutOf } from "../../src/room/score-scale.ts";
import collect from "../spec/page/collect.js";
import { CONTRAST, FLOORS } from "../spec/page/companion-checks.js";
import pageChecks from "../spec/page/play-checks.js";
import { borderHues } from "./border-walk.ts";
import { borderTokens, flush, motion } from "./companion-measure.ts";
import { MIN_NEXT_GAP, nameDrawnSmaller, nextRowAndScore, zoneWordsBroken } from "./fit-checks.ts";
import { HIDE, inkOf, shadowHues, TIERS } from "./measure.ts";
import type { Row } from "./measure.ts";

export interface PlayResult {
  readonly rows: Row[];
  readonly png: Buffer;
  /** Per tier, the smallest cap height over its floor: 1.03 is 3 % above. */
  readonly margins: Readonly<Record<string, number>>;
}

/** Text keeps this many pixels from each edge of a phone (P3), beside the device's own insets (none in a test). */
const PHONE_SAFE_PX = 8;
/** The room's safe area (C3): 5 % of each edge, on a tablet in landscape. */
const ROOM_SAFE = 0.05;

export async function checkPlayRoom(page: Page, probe: Page, width: number, height: number): Promise<PlayResult> {
  await page.evaluate(() => document.fonts.ready);
  await flush(page);
  const png = await page.screenshot();
  const layout = layoutOf(width, height);
  const { items, zones, hues, loose } = await page.evaluate(collect);
  const pageRows = await page.evaluate(pageChecks);
  // A constructed sheet: the page's CSP refuses an added <style>, as it should. Corners are squared
  // while the ink is measured (the kept screenshot above is the real page).
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
  const margins: Record<string, number> = {};
  const rows: Row[] = items.length ? [] : [{ tier: "text", text: "(none)", result: "FAIL no text was measured" }];
  for (const it of items) {
    const problems = [...it.problems];
    const k = it.ink;
    const tier = it.tier as string;
    if (!k) problems.push("no visible ink");
    else {
      // P1 and P2: the room's floors in landscape at least 720 lines, the companion's elsewhere.
      if (layout === "room") {
        const t = TIERS[(tier === "textmin" ? "text" : tier) as keyof typeof TIERS];
        if (!t) problems.push(`unknown tier ${tier}`);
        else {
          margins[tier] = Math.min(margins[tier] ?? Infinity, it.cap / t.cap);
          if (it.cap < t.cap - 0.00005) problems.push(`cap ${(it.cap * 100).toFixed(2)}% < ${(t.cap * 100).toFixed(1)}%`);
          if ((it.worst ?? Infinity) < t.contrast) problems.push(`contrast ${(it.worst ?? 0).toFixed(1)} < ${t.contrast}`);
        }
      } else {
        const floor = FLOORS[tier];
        if (!floor) problems.push(`unknown tier ${tier}`);
        else {
          const [portrait, landscape, px] = floor;
          const share = layout === "portrait" ? portrait : landscape;
          margins[tier] = Math.min(margins[tier] ?? Infinity, it.cap / share, (it.cap * height) / px);
          if (it.cap < share - 0.00005) problems.push(`cap ${(it.cap * 100).toFixed(2)}% < ${(share * 100).toFixed(1)}%`);
          if (it.cap * height < px - 0.05) problems.push(`cap ${(it.cap * height).toFixed(1)} px < ${px} px`);
          if ((it.worst ?? Infinity) < CONTRAST) problems.push(`contrast ${(it.worst ?? 0).toFixed(1)} < ${CONTRAST}`);
        }
      }
      // P3: the safe area.
      const sx = layout === "room" ? width * ROOM_SAFE : PHONE_SAFE_PX;
      const sy = layout === "room" ? height * ROOM_SAFE : PHONE_SAFE_PX;
      if (k.x0 < sx - 0.5 || k.y0 < sy - 0.5 || k.x1 > width - sx + 0.5 || k.y1 > height - sy + 0.5) problems.push("outside safe area");
      // P10: no two texts overlap.
      for (const o of items) {
        if (o === it || !o.ink || it.anc.includes(o.i)) continue;
        const b = o.ink;
        if (k.x0 < b.x1 && b.x0 < k.x1 && k.y0 < b.y1 && b.y0 < k.y1) problems.push(`overlaps "${o.text}"`);
      }
    }
    rows.push({ tier, text: it.text, result: problems.length ? `FAIL ${problems.join("; ")}` : "ok" });
  }
  // P7: the zone and its number, its name where the spec says.
  for (const z of zones) {
    const problems: string[] = [];
    if (z.z !== "-" && z.num !== z.z) problems.push(`number "${z.num}" is not ${z.z}`);
    if (z.problem) problems.push(z.problem);
    rows.push({ tier: "zone", text: `zone ${z.z} ${z.name}`.slice(0, 30), result: problems.length ? `FAIL ${problems.join("; ")}` : "ok" });
  }
  if (layout === "room") {
    for (const p of await nameDrawnSmaller(page)) rows.push({ tier: "gel", text: p.slice(0, 40), result: `FAIL ${p}` });
    for (const p of await zoneWordsBroken(page)) rows.push({ tier: "text", text: p.slice(0, 40), result: `FAIL ${p}` });
    // The next row keeps its distance from the score, as on the room screen (room-2d.md, "Layout"); the band's box is the score's.
    const next = await nextRowAndScore(page);
    const nextInk = items.filter((it) => next.items.includes(it.i) && it.ink);
    if (next.scoreTop !== null && nextInk.length) {
      const gap = next.scoreTop - Math.max(...nextInk.map((it) => it.ink!.y1));
      rows.push({ tier: "text", text: "next row above the score", result: gap < height * MIN_NEXT_GAP - 0.5 ? `FAIL next row ends ${((gap / height) * 100).toFixed(2)} vh above the score` : "ok" });
    }
  }
  // P10 coverage: every text is inside a measured element. P8: hue only in an element that stands for a zone.
  for (const t of loose) rows.push({ tier: "text", text: t, result: "FAIL text outside any data-tier element (P10)" });
  for (const h of [...hues, ...(await shadowHues(page)), ...(await borderHues(page))]) rows.push({ tier: "hue", text: h.slice(0, 40), result: "FAIL hue outside a zone (P8)" });
  for (const [text, result] of pageRows) rows.push({ tier: "play", text, result });
  // A transparent border draws nothing (the triangle of the "now" line is a border with three clear sides).
  rows.push(...(await borderTokens(page)).filter((r) => !r.text.includes("rgba(0, 0, 0, 0")));
  // P9: with reduced motion, no transition or animation lasts longer than 0; nothing repeats faster than three times a second.
  rows.push(...(await motion(page)));
  return { rows, png, margins };
}
