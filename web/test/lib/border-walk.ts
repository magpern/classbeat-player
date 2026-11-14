// The one walk over every drawn border and outline on a page, and the one `chroma` it is judged
// with. The companion's K8 (no hue outside a zone) and K10 (every drawn border is a token colour)
// both read from it, so they cannot drift apart.
//
// "Drawn" means: on an element or its ::before or ::after (a pseudo-element with `content: none`
// is not generated), on any of the four sides, with a style other than none or hidden and a width
// above 0; and an outline with a style other than none and a width above 0. The walk
// runs in the page; the colour test runs here.
import type { Page } from "playwright-core";

export interface Drawn {
  /** What a failure row prints: the element's class or tag, the pseudo-element, and the side or "outline". */
  readonly where: string;
  /** The computed colour, as the browser prints it. */
  readonly colour: string;
  /** True when the element is, or sits inside, an element that stands for a zone (.z1 to .z7). */
  readonly inZone: boolean;
}

/** Every drawn border side and outline on the page, with the colour the browser computed for it. */
export function drawnBorders(page: Page): Promise<Drawn[]> {
  return page.evaluate(() => {
    const found: { where: string; colour: string; inZone: boolean }[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const inZone = el.closest(".z1, .z2, .z3, .z4, .z5, .z6, .z7") !== null;
      for (const pseudo of [null, "::before", "::after"]) {
        const c = getComputedStyle(el, pseudo);
        if (pseudo && c.content === "none") continue;
        const name = `${el.className || el.tagName}${pseudo ?? ""}`;
        for (const side of ["top", "right", "bottom", "left"]) {
          const style = c.getPropertyValue(`border-${side}-style`);
          if (style === "none" || style === "hidden" || parseFloat(c.getPropertyValue(`border-${side}-width`)) === 0) continue;
          found.push({ where: `${name} border-${side}`, colour: c.getPropertyValue(`border-${side}-color`), inZone });
        }
        if (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) {
          found.push({ where: `${name} outline`, colour: c.outlineColor, inZone });
        }
      }
    }
    return found;
  });
}

/** Spread between the largest and smallest of r, g, b of a computed colour; 0 when fully transparent or unreadable. */
export function chroma(colour: string): number {
  const m = colour.match(/[\d.]+/g);
  if (!m || (m[3] !== undefined && Number(m[3]) === 0)) return 0;
  const [r, g, b] = m.slice(0, 3).map(Number);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** K8 / C6 / S4 on borders: outside a zone, no drawn side or outline carries a hue. One line per finding. */
export async function borderHues(page: Page): Promise<string[]> {
  return (await drawnBorders(page)).filter((d) => !d.inZone && chroma(d.colour) > 24).map((d) => `${d.where} ${d.colour}`);
}
