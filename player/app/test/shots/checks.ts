// The spec's measurable checks (docs/design/class-list.md, L3 to L8) on the live page, in the
// browser: no hue, no text below 14 px, controls at least 44 px high, nothing cut, nothing
// animating, the list region and the footer on screen. Returns a list of problems; empty is a pass.
// The contrast and cap-height checks of the mock-up run (docs/design/mockups/measure.js) are the
// design review's; these are the ones a unit-level run can hold on every change.
import type { Page } from "playwright-core";

const IN_PAGE = `(() => {
  const out = [];
  const label = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").join(".") : "") + ' "' + (el.textContent || "").trim().slice(0, 30) + '"';
  const spread = (c) => {
    const m = c.match(/[\\d.]+/g);
    if (!m || m.length < 3) return 0;
    const [r, g, b, a] = m.map(Number);
    return a === 0 ? 0 : Math.max(r, g, b) - Math.min(r, g, b);
  };
  const HUE = 12; // the tokens' warm whites differ by at most 11 between channels; a zone colour by far more
  for (const el of document.querySelectorAll("body, body *")) {
    const s = getComputedStyle(el);
    // Not painted (hidden), or the screen reader's own line: nothing to measure.
    if (el.matches("script, style") || s.display === "none" || el.closest(".visually-hidden, [hidden]") !== null) continue;
    for (const prop of ["color", "backgroundColor"]) if (spread(s[prop]) > HUE) out.push("hue in " + prop + ": " + label(el));
    if (parseFloat(s.borderTopWidth) > 0 && spread(s.borderTopColor) > HUE) out.push("hue in a border: " + label(el));
    if (parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== "none" && spread(s.outlineColor) > HUE) out.push("hue in an outline: " + label(el));
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
    if (hasText && parseFloat(s.fontSize) < 14) out.push("text below 14 px: " + label(el));
    if (el.matches("button, input") && el.getBoundingClientRect().height < 44) out.push("control below 44 px: " + label(el));
    const clamped = el.closest(".foot .t") !== null;
    if (hasText && !clamped && (el.scrollWidth > el.clientWidth + 1 && s.display !== "inline")) out.push("text cut sideways: " + label(el));
    if (hasText && !clamped && s.overflow !== "visible" && el.scrollHeight > el.clientHeight + 1 && !el.matches(".list")) out.push("text cut: " + label(el));
    if (s.animationName !== "none" || parseFloat(s.transitionDuration) > 0) out.push("motion: " + label(el));
  }
  if (document.getAnimations().length > 0) out.push("something animates");
  if (document.documentElement.scrollWidth > window.innerWidth) out.push("the page scrolls sideways");
  const app = document.getElementById("app");
  if (app.getBoundingClientRect().bottom > window.innerHeight + 1) out.push("the page runs past the window");
  const list = document.getElementById("list");
  if (list) {
    const box = list.getBoundingClientRect();
    const whole = (r) => r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
    const rows = [...list.querySelectorAll(".row")];
    const sel = rows.find((r) => r.classList.contains("sel"));
    if (sel && !whole(sel.getBoundingClientRect())) out.push("the selected row is not fully visible");
    const foot = document.querySelector(".foot");
    if (!foot) out.push("no footer");
    else if (foot.getBoundingClientRect().bottom > window.innerHeight + 1) out.push("the footer is off screen");
    out.push("rows:" + rows.filter((r) => whole(r.getBoundingClientRect())).length);
  }
  return out;
})()`;

export interface Report {
  readonly problems: string[];
  /** Rows fully visible in the list (0 when there is no list). */
  readonly rows: number;
}

export async function check(page: Page): Promise<Report> {
  const all = (await page.evaluate(IN_PAGE)) as string[];
  const rows = Number(all.find((p) => p.startsWith("rows:"))?.slice(5) ?? 0);
  return { problems: all.filter((p) => !p.startsWith("rows:")), rows };
}
