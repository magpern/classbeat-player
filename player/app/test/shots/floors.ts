// The presenter window's readability floors (sensors.md S1 to S6; riders-panel.md), measured on what
// headless Chrome draws: cap heights, contrast, cut text and sideways scroll, hue, and button heights.
// Shared by the presenter-style and sensors-panel shots.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { APP_DIR } from "./page.ts";

/** The floors, in CSS pixels of cap height and box height (sensors.md S1, S6). */
export const CAP_TEXT = 10.5;
export const CAP_CONTROL = 11.8;
export const CAP_READING = 17.5;
export const CONTROL_HEIGHT = 44;
export const CONTRAST = 7;

/** The tokens' whites, greys and black, as `r,g,b`: the only non-grey colours allowed (S5). */
const GREYS: readonly string[] = (() => {
  const css = readFileSync(join(APP_DIR, "src/renderer/design/tokens.css"), "utf8");
  return ["stage", "stage-raised", "stage-line", "light-1", "light-2", "light-3", "ink"].map((name) => {
    const hex = new RegExp(`--${name}:\\s*#([0-9a-f]{6});`).exec(css)?.[1];
    assert.ok(hex, `token --${name}`);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
  });
})();

export interface Floors {
  readonly cap: string[];
  readonly contrast: string[];
  readonly cut: string[];
  readonly hue: string[];
  readonly short: string[];
  readonly sheets: string[];
  readonly sideways: boolean;
  readonly riders: { top: number; bottom: number };
  /** The sensors panel's box, and whether its drawer is open. */
  readonly sensors: { top: number; bottom: number; open: boolean };
  readonly reading: number;
  /** With the drawer open: its fixed parts' foot, the list's visible height, whether the column scrolls. */
  readonly drawer: { foot: number; list: number; columnScrolls: boolean } | null;
}

/** Measures every drawn element against the floors. */
export const measure = (page: Page): Promise<Floors> =>
  page.evaluate(
    ({ greys, f }) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      const rgb = (c: string): number[] => c.match(/[\d.]+/g)!.map(Number);
      const lum = (c: number[]): number => {
        const [r, g, b] = c.slice(0, 3).map((v) => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const ground = (el: Element | null): number[] => {
        for (let e = el; e; e = e.parentElement) {
          const c = rgb(getComputedStyle(e).backgroundColor);
          if (c.length < 4 || c[3]! > 0) return c;
        }
        return [0, 0, 0];
      };
      const cap = (el: Element): number => {
        const cs = getComputedStyle(el);
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        return ctx.measureText("H").actualBoundingBoxAscent;
      };
      const shown = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      };
      const label = (el: Element): string => `${el.id || el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
      const out = { cap: [] as string[], contrast: [] as string[], cut: [] as string[], hue: [] as string[], short: [] as string[] };
      for (const el of document.querySelectorAll("body *")) {
        if (!shown(el) || el.closest("svg")) continue;
        const cs = getComputedStyle(el);
        for (const c of [cs.color, cs.backgroundColor, cs.borderTopColor]) {
          const m = rgb(c);
          if (m.length >= 4 && m[3] === 0) continue;
          if (greys.includes(m.slice(0, 3).join(","))) continue;
          if (Math.abs(m[0]! - m[1]!) > 2 || Math.abs(m[1]! - m[2]!) > 2) out.hue.push(`${label(el)} ${c}`);
        }
        if (el.tagName === "BUTTON" && el.getBoundingClientRect().height < f.CONTROL_HEIGHT - 0.5) out.short.push(`${label(el)} ${el.getBoundingClientRect().height}`);
        const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
        if (!own) continue;
        // A button's label and a rider's name take the control floor; a button's sub-line is a
        // state word (riders-panel.md: "Joining is open"), which takes the text floor.
        const control = (el.closest("button") !== null && !el.matches("button [id$='-sub']")) || el.matches("#riders-list span[dir]");
        const floor = control ? f.CAP_CONTROL : f.CAP_TEXT;
        const h = cap(el);
        if (h < floor) out.cap.push(`${label(el)} ${h.toFixed(1)} < ${floor}`);
        const a = lum(rgb(cs.color));
        const b = lum(ground(el));
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (ratio < f.CONTRAST) out.contrast.push(`${label(el)} ${ratio.toFixed(2)}`);
        const r = el.getBoundingClientRect();
        if (r.right > innerWidth + 0.5 || r.left < -0.5 || el.scrollWidth > el.clientWidth + 1) out.cut.push(label(el));
      }
      const row = document.getElementById("riders-row")!.getBoundingClientRect();
      const sensors = document.getElementById("sensors")!.getBoundingClientRect();
      return {
        ...out,
        sheets: [...document.styleSheets].map((s) => s.href ?? "inline"),
        sideways: document.scrollingElement!.scrollWidth > innerWidth,
        riders: { top: row.top, bottom: row.bottom },
        sensors: { top: sensors.top, bottom: sensors.bottom, open: !document.getElementById("sensors-drawer")!.hidden },
        reading: cap(document.getElementById("riders-count")!),
        drawer: document.getElementById("riders-drawer")!.hidden
          ? null
          : (() => {
              const list = document.getElementById("riders-list")!.getBoundingClientRect();
              const side = document.getElementById("side")!;
              return {
                foot: document.getElementById("riders-note")!.getBoundingClientRect().bottom,
                list: Math.min(list.bottom, innerHeight) - list.top,
                columnScrolls: side.scrollHeight > side.clientHeight + 1,
              };
            })(),
      };
    },
    { greys: GREYS, f: { CAP_TEXT, CAP_CONTROL, CONTROL_HEIGHT, CONTRAST } },
  );

