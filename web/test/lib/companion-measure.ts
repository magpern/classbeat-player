// The companion's measurable checks (docs/design/companion.md, K1 to K10) on the real page, in
// Chrome, on a page the fake has already brought to a state. Reuses the room screen's ink and hue
// measurement (measure.ts, page/collect.js, page/ink.js) with the companion's own floors: cap
// height as a share of the viewport height per orientation and a floor in CSS pixels (K1), 7 : 1
// for every text (K2), and the page checks of page/companion-checks.js (K4 to K6).
//
// The page's clock is paused (Playwright's clock), so no animation frame runs: a style change is
// flushed by reading the layout, and the screenshot paints it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import collect from "../spec/page/collect.js";
import pageChecks, { CONTRAST, FLOORS } from "../spec/page/companion-checks.js";
import { WEB_DIR } from "./browser.ts";
import { HIDE, inkOf, shadowHues } from "./measure.ts";
import type { Row } from "./measure.ts";

const flush = (page: Page): Promise<void> => page.evaluate(() => void document.body.getBoundingClientRect());

export interface CompanionResult {
  readonly rows: Row[];
  readonly png: Buffer;
  /** Per tier, the smallest cap height over its K1 floor (share and pixels both): 1.03 is 3 % above. */
  readonly margins: Readonly<Record<string, number>>;
}

type Rgba = readonly [number, number, number, number];

/** One CSS colour as the computed style would print it, as [r, g, b, alpha]; null for anything else (a var(), a keyword). */
export function parseColour(raw: string): Rgba | null {
  const v = raw.trim().toLowerCase();
  if (v === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
    const [r, g, b, a] = [0, 2, 4, 6].map((i) => (h.length > i ? parseInt(h.slice(i, i + 2), 16) : 255));
    return [r, g, b, Math.round((a / 255) * 100) / 100];
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(v);
  if (!fn) return null;
  const n = fn[1].split(/[\s,/]+/).filter(Boolean);
  if (n.length < 3 || n.length > 4) return null;
  const [r, g, b] = n.slice(0, 3).map((x) => (x.endsWith("%") ? (parseFloat(x) * 255) / 100 : parseFloat(x)));
  const a = n[3] === undefined ? 1 : n[3].endsWith("%") ? parseFloat(n[3]) / 100 : parseFloat(n[3]);
  if ([r, g, b, a].some(Number.isNaN)) return null;
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a * 100) / 100];
}

/** Every colour design/tokens.css gives a custom property, however it writes it (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), transparent). */
export function tokenColours(css = readFileSync(join(WEB_DIR, "src", "design", "tokens.css"), "utf8")): Rgba[] {
  const out: Rgba[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--[\w-]+:\s*([^;]+);/g)) {
    const c = parseColour(m[1]);
    if (c) out.push(c);
  }
  return out;
}

/**
 * K10: every border that is drawn, on any side of an element or of its ::before or ::after, and every
 * drawn outline is a token colour. A drawn transparent border passes only if a token is transparent.
 */
async function borderTokens(page: Page): Promise<Row[]> {
  const tokens = tokenColours().map((t) => t.join(","));
  const drawn = await page.evaluate(() => {
    const found: { where: string; colour: string }[] = [];
    for (const el of document.querySelectorAll("body *")) {
      for (const pseudo of [null, "::before", "::after"]) {
        const c = getComputedStyle(el, pseudo);
        if (pseudo && c.content === "none") continue;
        const name = `${el.className || el.tagName}${pseudo ?? ""}`;
        for (const side of ["top", "right", "bottom", "left"]) {
          const style = c.getPropertyValue(`border-${side}-style`);
          if (style === "none" || style === "hidden" || parseFloat(c.getPropertyValue(`border-${side}-width`)) === 0) continue;
          found.push({ where: `${name} border-${side}`, colour: c.getPropertyValue(`border-${side}-color`) });
        }
        if (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) found.push({ where: `${name} outline`, colour: c.outlineColor });
      }
    }
    return found;
  });
  return drawn
    .filter((d) => {
      const p = parseColour(d.colour);
      return !p || !tokens.includes(p.join(","));
    })
    .map((d) => ({ tier: "token", text: `${d.where} ${d.colour}`.slice(0, 40), result: "FAIL border or outline colour is not a design token (K10)" }));
}

/** K8 on borders: outside a zone, no side of any border, on an element or its ::before or ::after, carries a hue. */
async function borderHues(page: Page): Promise<Row[]> {
  const found = await page.evaluate(() => {
    const chroma = (s: string): number => {
      const m = s.match(/[\d.]+/g);
      if (!m || (m[3] !== undefined && Number(m[3]) === 0)) return 0;
      const [r, g, b] = m.slice(0, 3).map(Number);
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    const out: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".z1, .z2, .z3, .z4, .z5, .z6, .z7")) continue;
      for (const pseudo of [null, "::before", "::after"]) {
        const c = getComputedStyle(el, pseudo);
        if (pseudo && c.content === "none") continue;
        for (const side of ["top", "right", "bottom", "left"]) {
          const style = c.getPropertyValue(`border-${side}-style`);
          if (style === "none" || style === "hidden" || parseFloat(c.getPropertyValue(`border-${side}-width`)) === 0) continue;
          const colour = c.getPropertyValue(`border-${side}-color`);
          if (chroma(colour) > 24) out.push(`${el.className || el.tagName}${pseudo ?? ""} border-${side} ${colour}`);
        }
      }
    }
    return out;
  });
  return found.map((h) => ({ tier: "hue", text: h.slice(0, 40), result: "FAIL hue outside a zone (K8)" }));
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
  const margins: Record<string, number> = {};
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
      const m = Math.min(it.cap / share, (it.cap * height) / px);
      margins[it.tier] = Math.min(margins[it.tier] ?? Infinity, m);
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
  rows.push(...(await borderHues(page)));
  rows.push(...(await borderTokens(page)));
  rows.push(...(await motion(page)));
  return { rows, png, margins };
}
