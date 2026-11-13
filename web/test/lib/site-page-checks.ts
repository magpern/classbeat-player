// The website checks that read the page's structure rather than its ink (docs/design/site.md):
// S3 what is visible at once, S5 words with every marker, S6 no ellipsis, S7 controls, S8 focus,
// S9 reflow, S10 motion, S11 live text, S12 structure. Each returns [check, what, problems].
import type { Page } from "playwright-core";

export type Finding = readonly [string, string, readonly string[]];

/** S3: the header, the page title, any plate or note, and every field with its button, within `screens` windows of `height`. */
export function s3Visible(page: Page, height: number, screens: number): Promise<(readonly [string, readonly string[]])[]> {
  return page.evaluate(
    ({ height, screens }) => {
      const out: [string, string[]][] = [];
      const bottom = (e: Element): number => e.getBoundingClientRect().bottom + scrollY;
      const at = (sel: string, limit: number): void => {
        for (const e of document.querySelectorAll(sel)) {
          const b = bottom(e);
          out.push([`${sel} in view`, b > limit + 0.5 ? [`ends at ${Math.round(b)} px, after ${limit} px`] : []]);
        }
      };
      at("header", height);
      at("h1", height);
      at(".plate, .note", height);
      at("form input, form button[type=submit], .panel", height * screens);
      return out;
    },
    { height, screens },
  );
}

export function layoutChecks(page: Page, zoom: number): Promise<Finding[]> {
  return page.evaluate((zoom) => {
    const out: [string, string, string[]][] = [];
    const name = (e: Element): string => (e.textContent || e.getAttribute("aria-label") || e.className || e.tagName).toString().trim().replace(/\s+/g, " ").slice(0, 30);
    const shown = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      const c = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && r.bottom + scrollY > 0 && r.right > 0;
    };
    // S5: every marker has its words; "current" is a bar of at least 3 px, never colour alone.
    for (const e of document.querySelectorAll(".plate, .note, .status, .tag, .error")) out.push(["S5", name(e), e.textContent?.trim() ? [] : ["a marker without words"]]);
    for (const e of document.querySelectorAll("[aria-current]")) {
      const c = getComputedStyle(e);
      const bar = Math.max(parseFloat(c.borderBottomWidth), parseFloat(c.borderRightWidth));
      out.push(["S5", `current: ${name(e)}`, bar >= 3 ? [] : ["current shown without a bar"]]);
    }
    // S6: no ellipsis anywhere.
    for (const e of document.querySelectorAll("body *")) if (getComputedStyle(e).textOverflow === "ellipsis") out.push(["S6", name(e), ["ellipsis"]]);
    // S7: controls at least 44 px high (buttons and fields 48), at least 8 px apart.
    const controls = [...document.querySelectorAll("a[href], button, input")].filter((e) => shown(e) && !e.classList.contains("skip"));
    for (const e of controls) {
      const h = e.getBoundingClientRect().height;
      const least = (e.matches(".btn, input") ? 48 : 44) * 1;
      out.push(["S7", `height: ${name(e)}`, h < least - 0.5 ? [`${h.toFixed(1)} px < ${least} px`] : []]);
    }
    for (let i = 0; i < controls.length; i += 1) {
      for (let j = i + 1; j < controls.length; j += 1) {
        const a = controls[i].getBoundingClientRect();
        const b = controls[j].getBoundingClientRect();
        if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
        const gap = Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
        if (gap < 8 - 0.5) out.push(["S7", `gap: ${name(controls[i])} / ${name(controls[j])}`, [`${gap.toFixed(1)} px < 8 px`]]);
      }
    }
    // S9: no sideways scroll; at 200 % the text really is twice as large (sizes in rem).
    const sw = document.documentElement.scrollWidth;
    out.push(["S9", "no sideways scroll", sw > innerWidth ? [`scrollWidth ${sw} > ${innerWidth}`] : []]);
    const body = parseFloat(getComputedStyle(document.body).fontSize);
    out.push(["S9", "text follows the browser's size", Math.abs(body - 18 * zoom) > 0.5 ? [`body text ${body} px, not ${18 * zoom} px`] : []]);
    // S12: one h1 and one main; every field labelled; headings do not skip a level.
    out.push(["S12", "one h1 in one main", document.querySelectorAll("h1").length === 1 && document.querySelectorAll("main").length === 1 && !!document.querySelector("main h1") ? [] : ["not exactly one h1 in one main"]]);
    for (const i of document.querySelectorAll("input")) out.push(["S12", `label: ${i.name}`, i.labels && i.labels.length && i.labels[0].textContent?.trim() ? [] : ["a field without a label"]]);
    let level = 0;
    for (const h of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      const n = Number(h.tagName[1]);
      if (n > level + 1) out.push(["S12", `heading ${name(h)}`, [`h${n} after h${level}`]]);
      level = n;
    }
    return out;
  }, zoom);
}

/** S10 and S11: nothing animates or scrolls smoothly; no picture, so all text is live text. */
export function motionAndPictures(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const out: [string, string, string[]][] = [];
    const long = (v: string): boolean => v.split(",").some((d) => parseFloat(d) > 0);
    const moving = [...document.querySelectorAll("*")].filter((e) => {
      const c = getComputedStyle(e);
      return long(c.transitionDuration) || c.animationName !== "none" || c.scrollBehavior === "smooth";
    });
    out.push(["S10", "nothing animates", moving.map((e) => `moves: ${e.className || e.tagName}`)]);
    const pictures = [...document.querySelectorAll("img, svg, canvas, picture, video, object, embed, iframe")];
    const backgrounds = [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).backgroundImage !== "none");
    out.push(["S11", "no picture of text", [...pictures.map((e) => e.tagName), ...backgrounds.map((e) => `background on ${e.className || e.tagName}`)]]);
    return out;
  });
}

/**
 * S8 and the keyboard: Tab from the top reaches the skip link first, then every control in
 * reading order, each with a 3 px ring 3 px away (in --light-1; in ink on the white plate).
 */
export async function focusRing(page: Page): Promise<(readonly [string, readonly string[]])[]> {
  const expected = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled)")].filter((e) => e.getClientRects().length > 0).map((e) => (e.textContent || e.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 30)),
  );
  // Start at the skip link, by the keyboard (a ring shows for keyboard focus). A fresh page's
  // first Tab reaching the skip link is checked in the flows.
  await page.focus(".skip");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const seen: { name: string; ring: string; ok: boolean }[] = [];
  for (let i = 0; i < expected.length; i += 1) {
    if (i > 0) await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        const c = getComputedStyle(e);
        const inPlate = !!e.closest(".plate");
        const colour = inPlate ? "rgb(0, 0, 0)" : "rgb(246, 244, 239)";
        const ring = `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor} offset ${c.outlineOffset}`;
        return { name: (e.textContent || e.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 30), ring, ok: c.outlineStyle === "solid" && c.outlineWidth === "3px" && c.outlineOffset === "3px" && c.outlineColor === colour };
      }),
    );
  }
  const out: [string, string[]][] = [];
  out.push(["Tab order", seen.map((s) => s.name).join(" | ") === expected.join(" | ") ? [] : [`reached ${seen.map((s) => s.name).join(" | ")}; expected ${expected.join(" | ")}`]]);
  for (const s of seen) out.push([`ring: ${s.name}`, s.ok ? [] : [s.ring]]);
  return out;
}
