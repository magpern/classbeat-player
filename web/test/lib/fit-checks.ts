// Fitting checks of docs/design/room-2d.md, "Fitting text", that look at the laid-out page rather
// than at ink: the zone name's step, whole words in the time-in-zone list, and the clearance
// between the next row and the score. Each runs in the page and returns the problems it found.
import type { Page } from "playwright-core";

/** The next row's ink ends at least this share (0.8 vh: what the wide layout keeps, 0.89 vh) of the screen height above the score (room-2d.md, "Layout"). */
export const MIN_NEXT_GAP = 0.008;

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
 * is cut by `overflow-wrap: anywhere`, so each name is laid out once with breaking off and its
 * words must still fit (room-2d.md, "Time-in-zone list").
 */
export function zoneWordsBroken(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".zones .t")]
      .filter((t) => {
        const saved = t.style.overflowWrap;
        t.style.overflowWrap = "normal";
        const broken = t.scrollWidth > t.clientWidth + 1;
        t.style.overflowWrap = saved;
        return broken;
      })
      .map((t) => `zone name "${(t.textContent ?? "").slice(0, 24)}" has a word wider than its ${Math.round(t.clientWidth)}px column`),
  );
}

/** The indexes (data-mi) of the text elements of the next row, and the top of the score, in pixels. */
export function nextRowAndScore(page: Page): Promise<{ readonly items: number[]; readonly scoreTop: number | null }> {
  return page.evaluate(() => ({
    items: [...document.querySelectorAll<HTMLElement>(".next [data-mi]")].map((e) => Number(e.dataset.mi)),
    scoreTop: document.querySelector(".score")?.getBoundingClientRect().top ?? null,
  }));
}
