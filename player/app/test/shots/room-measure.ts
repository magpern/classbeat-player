// Check C10 (room-2d.md, "Checks") on the real room page, static part: the band's text passes C1 to
// C4 (the web lane's own page scripts, collect.js and ink.js, at the band's floors), the band is
// exactly the score's box, its buttons and QR code are big enough, nothing in it has a hue, and the
// pixels: hidden is the screen without the band, shown differs only inside the score's box.
import type { Browser, Page } from "playwright-core";
import collect from "../../../../web/test/spec/page/collect.js";
import type { Item } from "../../../../web/test/spec/page/collect.js";
import ink, { INK } from "../../../../web/test/spec/page/ink.js";

/** Cap height (share of the screen height) and contrast: labels and control words at 2 %, the code at 3 % (C10). */
const TIERS: Record<string, { cap: number; contrast: number }> = {
  control: { cap: 0.02, contrast: 7 },
  label: { cap: 0.02, contrast: 4.5 },
  text: { cap: 0.03, contrast: 7 },
  minor: { cap: 0.03, contrast: 7 },
};
const SAFE = 0.05;
const HIDE = "[data-tier], [data-tier] * { color: transparent !important; text-shadow: none !important; }";

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * Adds a style sheet for a check and returns how to take it off. A constructed sheet, not a
 * <style> tag: the room page's CSP (style-src 'self') stays in force during the checks.
 */
export async function addSheet(page: Page, css: string): Promise<() => Promise<void>> {
  await page.evaluate((css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, css);
  return () => page.evaluate(() => void (document.adoptedStyleSheets = document.adoptedStyleSheets.slice(0, -1)));
}

function paint(page: Page, it: Item, on: "repaint" | boolean): Promise<void> {
  return page.evaluate(
    ({ i, colors, on }) => {
      const el = document.querySelector(`[data-mi="${i}"]`);
      if (!el) return;
      [el, ...el.querySelectorAll("*")].forEach((n, k) => {
        const h = n as HTMLElement;
        if (on === "repaint") h.style.setProperty("color", "rgba(0, 0, 0, 0)", "important");
        else if (on) h.style.setProperty("color", `rgb(${colors[k]!.join(",")})`, "important");
        else h.style.removeProperty("color");
      });
    },
    { i: it.i, colors: it.colors, on },
  );
}

async function inkOf(page: Page, probe: Page, size: readonly [number, number], it: Item): Promise<{ worst: number; box: Box } | null> {
  const x0 = Math.max(0, Math.floor(it.box.x0) - 8);
  const y0 = Math.max(0, Math.floor(it.box.y0) - 8);
  const x1 = Math.min(size[0], Math.ceil(it.box.x1) + 8);
  const y1 = Math.min(size[1], Math.ceil(it.box.y1) + 8);
  if (x1 <= x0 || y1 <= y0) return null;
  const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  await paint(page, it, "repaint");
  const bg = await page.screenshot({ clip });
  await paint(page, it, true);
  const one = await page.screenshot({ clip });
  await paint(page, it, false);
  const r = await probe.evaluate(ink, [bg.toString("base64"), one.toString("base64"), it.colors, INK] as [string, string, number[][], number]);
  return r ? { worst: r.worst, box: { x0: r.box.x0 + x0, y0: r.box.y0 + y0, x1: r.box.x1 + x0, y1: r.box.y1 + y0 } } : null;
}

/** C1 to C4 for the band's text. One line per problem; empty is a pass. */
export async function bandText(page: Page, probe: Page, size: readonly [number, number]): Promise<string[]> {
  const { items } = await page.evaluate(collect);
  const inBand = new Set(await page.evaluate(() => [...document.querySelectorAll(".band [data-tier]")].map((e) => Number((e as HTMLElement).dataset.mi))));
  const band = items.filter((it) => inBand.has(it.i));
  const unhide = await addSheet(page, HIDE);
  const inked: (Item & { k: Box })[] = [];
  const out: string[] = [];
  for (const it of band) {
    const t = TIERS[it.tier];
    const r = await inkOf(page, probe, size, it);
    const problems = [...it.problems];
    if (!t) problems.push(`unknown tier ${it.tier}`);
    if (!r) problems.push("no visible ink");
    else if (t) {
      if (it.cap < t.cap) problems.push(`cap ${(it.cap * 100).toFixed(2)}% < ${t.cap * 100}%`);
      if (r.worst < t.contrast) problems.push(`contrast ${r.worst.toFixed(1)} < ${t.contrast}`);
      const k = r.box;
      if (k.x0 < size[0] * SAFE - 0.5 || k.y0 < size[1] * SAFE - 0.5 || k.x1 > size[0] * (1 - SAFE) + 0.5 || k.y1 > size[1] * (1 - SAFE) + 0.5) problems.push("outside safe area");
      inked.push({ ...it, k });
    }
    for (const p of problems) out.push(`"${it.text}": ${p}`);
  }
  for (const a of inked) for (const b of inked) {
    if (a.i < b.i && a.k.x0 < b.k.x1 && b.k.x0 < a.k.x1 && a.k.y0 < b.k.y1 && b.k.y0 < a.k.y1) out.push(`"${a.text}" overlaps "${b.text}"`);
  }
  await unhide();
  return out;
}

/** The band's geometry, its buttons, the QR code and its colours. One line per problem. */
export function bandShape(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const H = innerHeight;
    const band = document.querySelector(".band")!.getBoundingClientRect();
    const score = document.querySelector(".score")!.getBoundingClientRect();
    for (const k of ["left", "right", "top", "bottom"] as const) if (Math.abs(band[k] - score[k]) > 1) out.push(`band ${k} ${band[k]} is not the score's ${score[k]}`);
    const parts = [...document.querySelectorAll(".band .btn, .band .code, .band .q")].map((e) => [e, e.getBoundingClientRect()] as const);
    for (const [e, r] of parts) {
      if (r.top < band.top || r.bottom > band.bottom || r.left < band.left || r.right > band.right) out.push(`${e.className} leaves the band`);
      if (e.matches(".btn") && r.height < 0.094 * H - 0.5) out.push(`${(e as HTMLElement).dataset.id} is ${(r.height / H * 100).toFixed(2)} vh high`);
      if (e.matches(".btn") && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)) out.push(`${(e as HTMLElement).dataset.id} is cut`);
    }
    for (const [a, ra] of parts) for (const [b, rb] of parts) {
      if (a !== b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING && ra.left < rb.right && rb.left < ra.right && ra.top < rb.bottom && rb.top < ra.bottom) out.push(`${a.className} overlaps ${b.className}`);
    }
    const qr = document.querySelector(".band svg.qr");
    if (qr) {
      const r = qr.getBoundingClientRect();
      if (r.width / 37 < 2 || r.height / 37 < 2) out.push(`QR ${(r.width / 37).toFixed(2)} px per module`);
      if (qr.querySelector("rect")?.getAttribute("fill") !== "#ffffff" || qr.querySelector("path")?.getAttribute("fill") !== "#000000") out.push("QR not black on white");
    }
    // No hue (rule 7): white, grey and black only.
    const chroma = (s: string): number => {
      const m = s.match(/[\d.]+/g);
      if (!m || (m[3] !== undefined && Number(m[3]) === 0)) return 0;
      const [r, g, b] = m.slice(0, 3).map(Number) as [number, number, number];
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    for (const el of [document.querySelector(".band")!, ...document.querySelectorAll(".band *")]) {
      const c = getComputedStyle(el);
      for (const v of [c.color, c.backgroundColor, c.borderTopColor, c.outlineColor]) if (chroma(v) > 24) out.push(`hue in ${el.className}: ${v}`);
    }
    return out;
  });
}

/** Where End sits, to check that Keep going takes its place. */
export const endBox = (page: Page): Promise<Box> =>
  page.evaluate(() => {
    const r = document.querySelector('.band [data-id="end"]')!.getBoundingClientRect();
    return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
  });

/** "Keep going" covers the centre of End's box; "End class" is at least 5 vw from it. */
export function askShape(page: Page, end: Box): Promise<string[]> {
  return page.evaluate((end) => {
    const out: string[] = [];
    const keep = document.querySelector('.band [data-id="keep-going"]')!.getBoundingClientRect();
    const yes = document.querySelector('.band [data-id="end-class"]')!.getBoundingClientRect();
    const cx = (end.x0 + end.x1) / 2;
    const cy = (end.y0 + end.y1) / 2;
    if (!(keep.left <= cx && cx <= keep.right && keep.top <= cy && cy <= keep.bottom)) out.push("Keep going does not cover End's centre");
    if (end.x0 - yes.right < 0.05 * innerWidth - 0.5) out.push(`End class is ${((end.x0 - yes.right) / innerWidth * 100).toFixed(2)} vw from End`);
    if (keep.left - yes.right < 0.05 * innerWidth - 0.5) out.push("End class is under 5 vw from Keep going");
    return out;
  }, end);
}

/** The screen's pixels in a band of rows (whole width), as a PNG. */
// The beat dot is lit by a Web Animation on the compositor's own time, which the paused clock does
// not hold; it is masked in both pictures, and it lies outside the score's box anyway.
export const rows = (page: Page, y0: number, y1: number): Promise<Buffer> =>
  page.screenshot({ clip: { x: 0, y: y0, width: page.viewportSize()!.width, height: y1 - y0 }, animations: "disabled", mask: [page.locator(".beat")], maskColor: "#808080" });

/** The score's box, in whole pixels outward. */
export const scoreRows = (page: Page): Promise<[number, number]> =>
  page.evaluate(() => {
    const r = document.querySelector(".score")!.getBoundingClientRect();
    return [Math.floor(r.top), Math.ceil(r.bottom)] as [number, number];
  });

/** A page in which the ink comparisons run. */
export async function probePage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  return ctx.newPage();
}
