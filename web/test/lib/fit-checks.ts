// Fitting checks of docs/design/room-2d.md, "Fitting text", that look at the laid-out page rather
// than at ink: the zone name's step, whole words in the time-in-zone list, and the clearance
// between the next row and the score. Each runs in the page and returns the problems it found.
import type { Page } from "playwright-core";

/** The next row's ink ends at least this share (0.7 vh: what the wide layouts keep, 0.74 vh at 16:10 in CI's Chrome) of the screen height above the score (room-2d.md, "Layout"). */
export const MIN_NEXT_GAP = 0.007;

/**
 * A zone name that would fit at a larger size is never drawn smaller (room-2d.md, "Zone name on
 * the gel"). Every step above the one drawn is tried in turn, the name put back at that step's
 * size: one line at the full size, then two lines at the full size (the 3:2 and narrower step
 * below it is the smaller one), then the stepped two-line size. A step counts only when its
 * font is larger than the drawn one, so the two-line step that equals the full size at wider
 * screens is not a finding.
 */
export function nameDrawnSmaller(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const gel = document.querySelector(".gel") as HTMLElement | null;
    const name = gel?.querySelector(".gel-name") as HTMLElement | null;
    if (!gel || !name) return [];
    const cls = name.className;
    const drawn = parseFloat(getComputedStyle(name).fontSize);
    const attempts: { cls: string; lines: number }[] = [];
    if (name.classList.contains("long")) attempts.push({ cls: "gel-name n", lines: 2 }, { cls: "gel-name n two", lines: 2 });
    else if (name.classList.contains("two")) attempts.push({ cls: "gel-name n", lines: 1 });
    const found: string[] = [];
    for (const a of attempts) {
      name.className = a.cls;
      name.style.overflowWrap = "normal";
      const size = parseFloat(getComputedStyle(name).fontSize);
      const lines = Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight));
      const fits = name.scrollWidth <= name.clientWidth + 1 && lines <= a.lines && gel.scrollHeight <= gel.clientHeight + 1;
      name.style.overflowWrap = "";
      if (fits && size > drawn + 0.5) found.push(`name "${(name.textContent ?? "").slice(0, 20)}" drawn at ${drawn.toFixed(1)}px although it fits at ${size.toFixed(1)}px (${a.lines} line${a.lines > 1 ? "s" : ""})`);
    }
    name.className = cls;
    return found;
  });
}

/**
 * The time-in-zone list breaks a word only when it cannot help it: a word wider than its column
 * is cut by `overflow-wrap: anywhere`, so each word of a name is measured whole and must fit
 * (room-2d.md, "Time-in-zone list"). A word longer than FITTABLE_WORD letters (the worst cases'
 * 24-letter capitals) cannot fit any column and may break.
 */
const FITTABLE_WORD = 16;

export function zoneWordsBroken(page: Page): Promise<string[]> {
  return page.evaluate((maxLen) => {
    const found: string[] = [];
    for (const t of document.querySelectorAll<HTMLElement>(".zones .t")) {
      const cs = getComputedStyle(t);
      const probe = document.createElement("span");
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-weight:${cs.fontWeight};font-size:${cs.fontSize};font-family:${cs.fontFamily};letter-spacing:${cs.letterSpacing}`;
      document.body.append(probe);
      for (const word of (t.textContent ?? "").split(/\s+/).filter((w) => w.length > 0 && w.length <= maxLen)) {
        probe.textContent = word;
        if (probe.getBoundingClientRect().width > t.clientWidth + 1) found.push(`zone name word "${word}" is wider than its ${Math.round(t.clientWidth)}px column`);
      }
      probe.remove();
    }
    return found;
  }, FITTABLE_WORD);
}

/** The indexes (data-mi) of the text elements of the next row, and the top of the score, in pixels. */
export function nextRowAndScore(page: Page): Promise<{ readonly items: number[]; readonly scoreTop: number | null }> {
  return page.evaluate(() => ({
    items: [...document.querySelectorAll<HTMLElement>(".next [data-mi]")].map((e) => Number(e.dataset.mi)),
    scoreTop: document.querySelector(".score")?.getBoundingClientRect().top ?? null,
  }));
}
