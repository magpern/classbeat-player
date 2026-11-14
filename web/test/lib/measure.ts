// The measurable checks of docs/design/room-2d.md (C1 to C8) on the real screen, in Chrome.
// Ported from docs/design/mockups/measure.js; C9 (the palette) is palette.ts.
//
// Each text element marked data-tier is rendered alone (all other text transparent) and compared
// with the picture without any text; the pixels that differ are its ink (page/ink.js). The ink
// threshold is 90 (the sum of the RGB differences): Chromium repaints anti-aliased rounded corners
// by about 45 between two screenshots, so a lower threshold counts outlines as ink. It trims a
// light-on-dark ink box by about a pixel at its edges, which C1 to C4 tolerate.
//
// C1 cap height, C2 contrast, C3 safe area, C4 collisions, C5 zone, C6 hue (text, fills, borders,
// box-shadows and gradients), C7 reduced motion, C8 coverage.
import type { Browser, Page } from "playwright-core";
import collect from "../spec/page/collect.js";
import { borderHues } from "./border-walk.ts";
import type { Item } from "../spec/page/collect.js";
import ink, { INK } from "../spec/page/ink.js";
import { harnessUrl, newPage, settle } from "./browser.ts";
import { MIN_NEXT_GAP, nameDrawnSmaller, nextRowAndScore, zoneWordsBroken } from "./fit-checks.ts";

/** Minimum cap height (share of the screen height) and contrast per type tier (room-2d.md, C1, C2). */
export const TIERS = {
  hero: { cap: 0.2, contrast: 7 },
  gel: { cap: 0.25, contrast: 7 },
  value: { cap: 0.055, contrast: 7 },
  text: { cap: 0.03, contrast: 7 },
  minor: { cap: 0.03, contrast: 7 },
  label: { cap: 0.02, contrast: 4.5 },
} as const;
const SAFE = 0.05;

// All text transparent. A text element's own outline (the FTP test tag) is hidden in both
// pictures too: Chromium anti-aliases a border at a fractional position differently after the
// text inside it is repainted, which would count the outline as ink.
export const HIDE = "[data-tier], [data-tier] * { color: transparent !important; text-shadow: none !important; } [data-tier] { border-color: transparent !important; }";

export interface Shot {
  readonly fixture: string;
  readonly width: number;
  readonly height: number;
  /** A room screen (cap heights and the safe area apply) rather than the small preview. */
  readonly room: boolean;
}

export const shotName = (s: Shot): string => `${s.fixture}-${s.width}x${s.height}`;

export interface Row {
  readonly tier: string;
  readonly text: string;
  readonly result: string;
}

export interface ShotResult {
  readonly shot: Shot;
  readonly rows: Row[];
  readonly failed: number;
  readonly png: Buffer;
  readonly heroCap: number;
  readonly valueCap: number;
}

// Colours in computed styles come as rgb(), rgba() or color(srgb r g b / a) with 0 to 1 channels.
const CHROMA_OUTSIDE_ZONE = 24;

function paint(page: Page, it: Item, on: "repaint" | boolean): Promise<void> {
  return page.evaluate(
    ({ i, colors, on }) => {
      const el = document.querySelector(`[data-mi="${i}"]`);
      if (!el) return;
      [el, ...el.querySelectorAll("*")].forEach((n, k) => {
        const h = n as HTMLElement;
        if (on === "repaint") h.style.setProperty("color", "rgba(0, 0, 0, 0)", "important");
        else if (on) h.style.setProperty("color", `rgb(${colors[k].join(",")})`, "important");
        else h.style.removeProperty("color");
      });
    },
    { i: it.i, colors: it.colors, on },
  );
}

/** The ink of one text item: its box on the page and its worst contrast. `wait` lets a page whose clock is paused (no animation frames) flush its style changes another way. */
export async function inkOf(page: Page, probe: Page, s: { readonly width: number; readonly height: number }, it: Item, wait: (p: Page) => Promise<void> = settle) {
  // The element's box, clipped to the screen, with a margin for ink outside its line box.
  const bx0 = Math.max(0, Math.floor(it.box.x0) - 8);
  const by0 = Math.max(0, Math.floor(it.box.y0) - 8);
  const bx1 = Math.min(s.width, Math.ceil(it.box.x1) + 8);
  const by1 = Math.min(s.height, Math.ceil(it.box.y1) + 8);
  if (bx1 <= bx0 || by1 <= by0) return null;
  const clip = { x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 };
  await paint(page, it, "repaint");
  await wait(page);
  const bg = await page.screenshot({ clip });
  await paint(page, it, true);
  await wait(page);
  const one = await page.screenshot({ clip });
  await paint(page, it, false);
  await wait(page);
  const args: [string, string, number[][], number] = [bg.toString("base64"), one.toString("base64"), it.colors, INK];
  const r = await probe.evaluate(ink, args);
  if (!r) return null;
  return { worst: r.worst, box: { x0: r.box.x0 + bx0, y0: r.box.y0 + by0, x1: r.box.x1 + bx0, y1: r.box.y1 + by0 } };
}

/** Hue (not grey) in a box-shadow, text-shadow or gradient outside an element that stands for a zone. */
export function shadowHues(page: Page): Promise<string[]> {
  return page.evaluate((limit) => {
    const chroma = (v: string): number[] => {
      const out: number[] = [];
      for (const m of v.matchAll(/(rgba?|color)\(([^)]*)\)/g)) {
        const nums = m[2].replace("srgb", "").split("/")[0].match(/[\d.]+/g)?.map(Number) ?? [];
        if (nums.length < 3) continue;
        const scale = m[1] === "color" ? 255 : 1;
        const [r, g, b] = nums.slice(0, 3).map((n) => n * scale);
        const alpha = m[2].includes("/") ? Number(m[2].split("/")[1]) : nums[3] ?? 1;
        if (alpha > 0) out.push(Math.max(r, g, b) - Math.min(r, g, b));
      }
      return out;
    };
    const found: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".z1, .z2, .z3, .z4, .z5, .z6, .z7")) continue;
      const c = getComputedStyle(el);
      for (const [p, v] of [["box-shadow", c.boxShadow], ["text-shadow", c.textShadow], ["background-image", c.backgroundImage]] as const) {
        if (v !== "none" && chroma(v).some((x) => x > limit)) found.push(`${el.className || el.tagName} ${p}`);
      }
    }
    return found;
  }, CHROMA_OUTSIDE_ZONE);
}

/** C7: with reduced motion, no transition or animation lasts longer than 0. */
async function movingWithReducedMotion(browser: Browser, s: Shot): Promise<string[]> {
  const page = await newPage(browser, { width: s.width, height: s.height, reducedMotion: true });
  // Not frozen: the transitions and animations must be there, and be zero.
  await page.goto(harnessUrl(s.fixture, "steady=1"));
  const moving = await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((el) => {
        const c = getComputedStyle(el);
        const long = (v: string): boolean => v.split(",").some((d) => parseFloat(d) > 0);
        return long(c.transitionDuration) || (c.animationName !== "none" && long(c.animationDuration));
      })
      .map((el) => String(el.className || el.tagName)),
  );
  await page.context().close();
  return moving;
}

export async function checkShot(browser: Browser, probe: Page, s: Shot): Promise<ShotResult> {
  const page = await newPage(browser, { width: s.width, height: s.height });
  // No request leaves the machine: the screen is self-contained, fonts included.
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("file:")) external.push(r.url());
  });
  await page.route(/^(?!file:)/, (r) => r.abort());
  await page.goto(harnessUrl(s.fixture));
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  const png = await page.screenshot();
  const { items, zones, hues, loose } = await page.evaluate(collect);
  await page.addStyleTag({ content: HIDE });
  for (const it of items) {
    const r = await inkOf(page, probe, s, it);
    it.ink = r?.box ?? null;
    it.worst = r ? r.worst : Infinity;
  }
  // The preview in the presenter window is read at arm's length: no room-distance cap heights and
  // no projector safe area (contrast, overlap and zone checks still apply).
  const rows: Row[] = [];
  for (const it of items) {
    const t = TIERS[it.tier];
    const problems = [...it.problems];
    const k = it.ink;
    if (!k) problems.push("no visible ink");
    else {
      if (s.room && it.cap < t.cap) problems.push(`cap ${(it.cap * 100).toFixed(2)}% < ${t.cap * 100}%`);
      if ((it.worst ?? Infinity) < t.contrast) problems.push(`contrast ${(it.worst ?? 0).toFixed(1)} < ${t.contrast}`);
      if (s.room && (k.x0 < s.width * SAFE - 0.5 || k.y0 < s.height * SAFE - 0.5 || k.x1 > s.width * (1 - SAFE) + 0.5 || k.y1 > s.height * (1 - SAFE) + 0.5)) problems.push("outside safe area");
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
  for (const p of await nameDrawnSmaller(page)) rows.push({ tier: "gel", text: p.slice(0, 40), result: `FAIL ${p}` });
  for (const p of await zoneWordsBroken(page)) rows.push({ tier: "text", text: p.slice(0, 40), result: `FAIL ${p}` });
  // The next row's ink keeps its distance from the score (room-2d.md, "Layout"), at every room size.
  const next = await nextRowAndScore(page);
  const nextInk = items.filter((it) => next.items.includes(it.i) && it.ink);
  if (s.room && next.scoreTop !== null && nextInk.length) {
    const gap = next.scoreTop - Math.max(...nextInk.map((it) => it.ink!.y1));
    rows.push({ tier: "text", text: "next row above the score", result: gap < s.height * MIN_NEXT_GAP - 0.5 ? `FAIL next row ends ${(gap / s.height * 100).toFixed(2)} vh above the score, at least ${(MIN_NEXT_GAP * 100).toFixed(1)} vh` : "ok" });
  }
  for (const t of loose) rows.push({ tier: "text", text: t, result: "FAIL text outside any data-tier element (C8)" });
  for (const h of [...hues, ...(await shadowHues(page)), ...(await borderHues(page))]) rows.push({ tier: "hue", text: h.slice(0, 40), result: "FAIL hue outside a zone (C6)" });
  const moving = await movingWithReducedMotion(browser, s);
  rows.push({ tier: "motion", text: "reduced motion", result: moving.length ? `FAIL still moves: ${moving.join(", ")}` : "ok" });
  for (const e of external) rows.push({ tier: "network", text: e.slice(0, 40), result: "FAIL external request" });
  await page.context().close();
  const inked = items.filter((it) => it.ink);
  const minCap = (tier: string): number => Math.min(...inked.filter((it) => it.tier === tier).map((it) => it.cap));
  return { shot: s, rows, failed: rows.filter((r) => r.result !== "ok").length, png, heroCap: minCap("hero"), valueCap: minCap("value") };
}
