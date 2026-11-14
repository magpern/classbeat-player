// The measurable checks of docs/design/site.md (S1 to S12) on the real website pages, in Chrome,
// on the fake backend. Text is measured the way the mock-ups' measure.js does it (collect.js and
// ink.js, shared with the room screen's checks): each text element is drawn alone and compared
// with the page without text. The page is measured at its full height (the mock-ups' fit.js).
import type { Browser, Page } from "playwright-core";
import collect from "../spec/page/collect.js";
import type { Item } from "../spec/page/collect.js";
import ink, { INK } from "../spec/page/ink.js";
import { borderHues } from "./border-walk.ts";
import { settle } from "./browser.ts";
import { openSite, traps } from "./site-fake.ts";
import type { FakeSite } from "./site-fake.ts";
import { focusRing, layoutChecks, motionAndPictures, s3Visible } from "./site-page-checks.ts";
import type { State } from "./site-states.ts";

export interface SiteShot {
  readonly state: State;
  readonly width: number;
  /** The browser's text size: 1 is 100 %, 2 is 200 % (S9). */
  readonly zoom: 1 | 2;
  /** Measure the ink of every text (S1, S2 and overlaps); reflow-only shots skip it. */
  readonly ink: boolean;
}

export const siteShotName = (s: SiteShot): string => `site-${s.state.name}-${s.width}${s.zoom === 2 ? "-text200" : ""}`;

export interface Row {
  readonly check: string;
  readonly text: string;
  readonly result: string;
}

export interface SiteResult {
  readonly shot: SiteShot;
  readonly rows: Row[];
  readonly png: Buffer;
}

const CONTRAST = { minor: 7, label: 4.5 } as const;
// All text transparent, set through the CSSOM so the page's CSP (no inline style) still holds.
const HIDE = "[data-tier], [data-tier] * { color: transparent !important; text-shadow: none !important; } [data-tier] { border-color: transparent !important; }";

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

async function inkOf(page: Page, probe: Page, w: number, h: number, it: Item) {
  const bx0 = Math.max(0, Math.floor(it.box.x0) - 8);
  const by0 = Math.max(0, Math.floor(it.box.y0) - 8);
  const bx1 = Math.min(w, Math.ceil(it.box.x1) + 8);
  const by1 = Math.min(h, Math.ceil(it.box.y1) + 8);
  if (bx1 <= bx0 || by1 <= by0) return null;
  const clip = { x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 };
  await paint(page, it, "repaint");
  await settle(page);
  const bg = await page.screenshot({ clip });
  await paint(page, it, true);
  await settle(page);
  const one = await page.screenshot({ clip });
  await paint(page, it, false);
  await settle(page);
  const r = await probe.evaluate(ink, [bg.toString("base64"), one.toString("base64"), it.colors, INK] as [string, string, number[][], number]);
  if (!r) return null;
  return { worst: r.worst, box: { x0: r.box.x0 + bx0, y0: r.box.y0 + by0, x1: r.box.x1 + bx0, y1: r.box.y1 + by0 } };
}

/** Opens the state on the fake backend at the shot's width and text size, then fits the window to the page. */
export async function reach(browser: Browser, s: SiteShot): Promise<FakeSite> {
  const site = await openSite(browser, s.state.path, { width: s.width, height: 800, script: s.state.script, passkey: s.state.passkey, fontSize: 16 * s.zoom });
  await s.state.steps?.(site.page);
  await site.page.waitForSelector(s.state.ready, { timeout: 5000 });
  await site.page.evaluate(() => document.fonts.ready);
  await settle(site.page);
  return site;
}

export async function checkSiteShot(browser: Browser, probe: Page, s: SiteShot): Promise<SiteResult> {
  const site = await reach(browser, s);
  const { page } = site;
  const rows: Row[] = [];
  const add = (check: string, text: string, problems: readonly string[]): void => {
    rows.push({ check, text, result: problems.length ? `FAIL ${problems.join("; ")}` : "ok" });
  };
  // S3 is read at the spec's windows before the window is fitted to the page.
  if (s.zoom === 1 && (s.width === 390 || s.width === 1280)) for (const [text, p] of await s3Visible(page, s.width === 390 ? 844 : 800, s.width === 390 ? 2 : 1)) add("S3", text, p);
  const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  await page.setViewportSize({ width: s.width, height });
  await settle(page);
  const png = await page.screenshot();
  const { items, zones, hues, loose } = await page.evaluate(collect);
  const meta = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-mi]")].map((e) => ({ i: Number(e.dataset.mi), min: Number(e.dataset.minCap || 0), size: parseFloat(getComputedStyle(e).fontSize) })),
  );
  const metaOf = (i: number) => meta.find((m) => m.i === i) ?? { i, min: 0, size: 0 };
  if (s.ink) {
    await page.evaluate((css) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }, HIDE);
    for (const it of items.filter((x) => x.box.y1 > 0)) {
      const r = await inkOf(page, probe, s.width, height, it);
      it.ink = r?.box ?? null;
      it.worst = r ? r.worst : Infinity;
    }
  }
  for (const it of items) {
    // The skip link waits above the page until it has focus (the focus check reaches it).
    if (it.box.y1 <= 0) continue;
    const m = metaOf(it.i);
    // At 200 % text the lines are allowed to wrap more; nothing may be cut or covered.
    const problems = s.zoom === 1 ? [...it.problems] : it.problems.filter((p) => !p.startsWith("wraps to"));
    const capPx = it.cap * height;
    // S1: the cap height for the size the text is set in; no text under 14 px, nothing under 16 px but a label.
    if (capPx < m.min * s.zoom - 0.05) problems.push(`cap ${capPx.toFixed(1)} px < ${m.min * s.zoom} px`);
    const least = (it.tier === "label" ? 14 : 16) * s.zoom;
    if (m.size < least) problems.push(`set in ${m.size} px < ${least} px`);
    if (s.ink) {
      const k = it.ink;
      if (!k) problems.push("no visible ink");
      else {
        // S2: worst pixel.
        const need = it.tier === "label" ? CONTRAST.label : CONTRAST.minor;
        if ((it.worst ?? Infinity) < need) problems.push(`contrast ${(it.worst ?? 0).toFixed(1)} < ${need}`);
        for (const o of items) {
          if (o === it || !o.ink || it.anc.includes(o.i)) continue;
          const b = o.ink;
          if (k.x0 < b.x1 && b.x0 < k.x1 && k.y0 < b.y1 && b.y0 < k.y1) problems.push(`overlaps "${o.text}"`);
        }
      }
    }
    add(it.tier === "label" ? "S1 S2 S6 label" : "S1 S2 S6", it.text, problems);
  }
  // S4: no hue at all, and no zone on these pages.
  for (const h of [...hues, ...(await borderHues(page))]) add("S4", h.slice(0, 40), ["hue"]);
  for (const z of zones) add("S4", `zone ${z.z}`, ["a zone element on a site page"]);
  for (const t of loose) add("S11", t, ["text outside any measured element"]);
  for (const [check, text, p] of await layoutChecks(page, s.zoom)) add(check, text, p);
  for (const [check, text, p] of await motionAndPictures(page)) add(check, text, p);
  if (s.zoom === 1) for (const [text, p] of await focusRing(page)) add("S8", text, p);
  for (const e of site.external) add("CSP", e.slice(0, 40), ["a request to another origin"]);
  for (const v of (await traps(page)).filter((x) => x.kind === "csp")) add("CSP", v.detail.slice(0, 40), ["CSP violation"]);
  for (const c of site.console.filter((x) => !x.includes("Failed to load resource"))) add("console", c.slice(0, 40), ["console output"]);
  await site.context.close();
  return { shot: s, rows, png };
}
