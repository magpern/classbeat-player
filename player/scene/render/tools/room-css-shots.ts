// The scene's text layer on a page that also carries the plain screen's stylesheet (the real room page does: dist/room.html
// loads web/src/room/room.css beside the scene). That sheet's global `.cue`, `.next` ... rules must not reach `#text`: at 5:4
// its `.cue { top: 60.2vh }` pulled the current cue up over the next row's cue (#823). The demo page loads no such sheet, so this
// check injects the real one (read-only) and asserts the cue still ends at its spec line and that nothing overlaps.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Page } from "playwright-core";
import { overlapScript } from "./page-checks.ts";
import { RENDER_DIR } from "./tokens-file.ts";

type Open = (w: number, h: number, query: string) => Promise<{ page: Page; problems: string[] }>;

const ROOM_CSS = join(RENDER_DIR, "..", "..", "..", "web", "src", "room", "room.css");

/** One `@import` rule's text after the keyword: a quoted or unquoted `url(...)` or a bare string, and nothing else. The sheet is
 *  inlined as it is, so a media, layer or supports condition (which would have to wrap it) is refused, not dropped. */
const IMPORT_TARGET = /^\s*(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']+))\s*\)|"([^"]*)"|'([^']*)')\s*$/;

/** The sheet with its `@import "./x.css";` lines replaced by the imported sheets' text, depth first. A constructed sheet drops
 *  `@import` silently, so each one is inlined here; one that is not a relative file inside the room folder (whole path segments:
 *  `../roomx` is not inside `room`), carries a condition, or is missing, throws. */
export function withImports(file: string, root = dirname(file), seen: string[] = []): string {
  if (seen.includes(file)) throw new Error(`room.css: @import cycle at ${file}`);
  return readFileSync(file, "utf8").replace(/@import\b([^;]*);/g, (_m, rule: string) => {
    const found = IMPORT_TARGET.exec(rule);
    if (found === null) throw new Error(`room.css: @import${rule} has a condition or a form that is not inlined`);
    const ref = found.slice(1).find((x) => x !== undefined) ?? "";
    const target = resolve(dirname(file), ref);
    const inside = relative(root, target);
    if (!/^\.\.?\//.test(ref) || inside === "" || inside.split(/[\\/]/)[0] === ".." || isAbsolute(inside)) throw new Error(`room.css: @import "${ref}" is not a relative sheet inside ${root}`);
    return withImports(target, root, [...seen, file]);
  });
}

/** The scene spec's colours (scene.md S2: all text over the scene is --light-1; the gel's labels are ink), read from the page as
 *  computed values, so page CSS that beats the text layer shows up here (#829). */
const colourScript = `(() => {
  const rgb = (token) => { const p = document.createElement("i"); p.style.color = "var(" + token + ")"; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const light1 = rgb("--light-1");
  const ink = rgb("--ink");
  const out = [];
  const text = document.querySelector("#text");
  const check = (what, got, want) => { if (got !== want) out.push(what + " is " + got + ", not " + want); };
  const all = (sel) => [...text.querySelectorAll(sel)];
  const seen = { link: 0, lbl: 0, seg: 0, gelLbl: 0 };
  for (const el of all(".link:not(.alert)")) { seen.link++; check(".link text", getComputedStyle(el).color, light1); check(".link marker", getComputedStyle(el, "::before").backgroundColor, light1); }
  for (const el of all(".lbl")) {
    if (el.closest(".gel")) { if (!el.closest(".gel.down")) { seen.gelLbl++; check(".gel .lbl", getComputedStyle(el).color, ink); } continue; }
    seen.lbl++; check(".lbl outside the gel", getComputedStyle(el).color, light1);
  }
  for (const el of all(".rail .seg")) { seen.seg++; check(".rail .seg", getComputedStyle(el).color, light1); }
  // The marker shapes (#822), in the colour of the text beside them and in their own geometry: the dot and the ring are round, the square is not, all 1.4 vh across.
  const link = all(".link:not(.alert)")[0];
  if (link) {
    const keep = link.className;
    const side = innerHeight * 0.014;
    for (const shape of ["dot", "sq", "rg"]) {
      link.className = shape === "dot" ? "link" : "link " + shape;
      const b = getComputedStyle(link, "::before");
      const what = ".link." + shape + " marker";
      if (shape === "rg") check(what + " colour", (b.backgroundImage.match(/rgb\\([^)]*\\)/g) || []).slice(-1)[0] || b.backgroundImage, light1);
      else check(what + " colour", b.backgroundColor, light1);
      check(what + " corners", b.borderTopLeftRadius, shape === "sq" ? "0px" : "50%");
      for (const side2 of ["width", "height"]) if (Math.abs(parseFloat(b[side2]) - side) > 0.6) out.push(what + " " + side2 + " is " + b[side2] + ", not " + side.toFixed(1) + "px (1.4 vh)");
      if (shape === "rg" && !/^radial-gradient\\(circle/.test(b.backgroundImage)) out.push(what + " is not a ring: " + b.backgroundImage);
    }
    link.className = keep;
  }
  // The cue box is placed by bottom alone: the plain screen's .cue rules (top, which the end position below holds, and max-height, overflow, text-wrap) must not reach it (#823).
  const cue = getComputedStyle(text.querySelector(".cue"));
  check(".cue max-height", cue.maxHeight, "none");
  check(".cue overflow", cue.overflow, "visible");
  check(".cue text-wrap", cue.textWrap || cue.textWrapMode + " " + cue.textWrapStyle, "wrap");
  for (const [k, n] of Object.entries(seen)) if (n === 0) out.push("no " + k + " element on the page to check");
  return out;
})()`;
/** Size, and where the current cue's box ends (scene.md "Layout": 68.4 vh wide, 80.3 vh at 3:2 and narrower). */
const CASES = [["16x9", 1920, 1080, 68.4], ["4x3", 1440, 1080, 80.3], ["5x4", 1279, 1023, 80.3]] as const;

export async function pageStylesheetDoesNotReachTheCue(open: Open): Promise<void> {
  const css = withImports(ROOM_CSS);
  const failures: string[] = [];
  for (const [name, w, h, endVh] of CASES) {
    const { page, problems } = await open(w, h, "&class=long");
    // A constructed sheet: the page's CSP allows no inline <style>.
    await page.evaluate(async (text) => { const sheet = new CSSStyleSheet(); await sheet.replace(text); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }, css);
    await page.evaluate(() => (window as unknown as { __scene: { advance(a: number, b: number, fps: number): void; settle(): void } }).__scene.advance(279_000, 285_000, 60));
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => (window as unknown as { __scene: { settle(): void } }).__scene.settle());
    const m = await page.evaluate(() => {
      const r = document.querySelector("#text .cue")!.getBoundingClientRect();
      return { bottom: r.bottom, height: r.height, vh: window.innerHeight };
    });
    const where = `room.css loaded, ${name}`;
    for (const c of await page.evaluate(colourScript) as string[]) failures.push(`${where}: ${c}`);
    if (Math.abs(m.bottom / m.vh * 100 - endVh) >= 0.3) failures.push(`${where}: the cue ends at ${(m.bottom / m.vh * 100).toFixed(1)} vh, not ${endVh}`);
    for (const o of await page.evaluate(overlapScript) as string[]) failures.push(`${where}: S16 ${o}`);
    await page.close();
    // After the close, so an error raised after the last check (a late frame, a rejected promise) is still collected.
    for (const p of problems) failures.push(`${where}: ${p}`);
  }
  assert.deepEqual(failures, [], "the page stylesheet reaches the text layer");
}
