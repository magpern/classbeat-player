// The presenter's style (#682; presenter.md, riders-panel.md, sensors.md part 2) on the real page
// (dist/presenter.html) in headless Chrome, with a class open, at 1000x720 and 1280x800: the
// readability floors S1 to S6 measured on what is drawn, and the page's style coming only from its
// own bundled sheet (an injected <style> or style attribute is refused by the policy). The views
// come from the real controller and live client over the fake relay. No Electron, no network.
// Screenshots go to screenshots/ for the Designer. Needs `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { MAX_RIDERS } from "../../src/core/live/riders-model.ts";
import { PAIRED } from "../unit/list-fixtures.ts";
import { started } from "../unit/live-relay.ts";
import type { Rig } from "../unit/live-relay.ts";
import { APP_DIR, launchChrome, SHOT_DIR } from "./page.ts";

const SIZES: readonly (readonly [number, number])[] = [[1000, 720], [1280, 800]];

/** The floors, in CSS pixels of cap height and box height (sensors.md S1, S6). */
const CAP_TEXT = 10.5;
const CAP_CONTROL = 11.8;
const CAP_READING = 17.5;
const CONTROL_HEIGHT = 44;
const CONTRAST = 7;

/** The tokens' whites, greys and black, as `r,g,b`: the only non-grey colours allowed (S5). */
const GREYS: readonly string[] = (() => {
  const css = readFileSync(join(APP_DIR, "src/renderer/design/tokens.css"), "utf8");
  return ["stage", "stage-raised", "stage-line", "light-1", "light-2", "light-3", "ink"].map((name) => {
    const hex = new RegExp(`--${name}:\\s*#([0-9a-f]{6});`).exec(css)?.[1];
    assert.ok(hex, `token --${name}`);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
  });
})();

interface Shot {
  readonly name: string;
  readonly rig: Rig;
  /** Buttons pressed after the page loads. */
  readonly act: readonly string[];
}

const STUB = `
  window.player = {
    getState: () => Promise.resolve(window.__state),
    command: () => Promise.resolve(window.__state),
    openDropped: () => Promise.resolve(window.__state),
    onUpdate: () => undefined,
    startPairing: () => Promise.resolve(window.__pairing),
    pairingState: () => Promise.resolve(window.__pairing),
    reopenPairingPage: () => Promise.resolve(window.__pairing),
    unpair: () => Promise.resolve(window.__pairing),
    liveView: () => Promise.resolve(window.__live ?? null),
    startLive: () => Promise.resolve(window.__live ?? null),
    endLive: () => Promise.resolve(window.__live ?? null),
    makeControlCode: () => Promise.resolve(window.__live ?? null),
    dropPhone: () => Promise.resolve(window.__live ?? null),
    riders: () => Promise.resolve(window.__riders ?? null),
    dropRider: () => Promise.resolve(window.__riders ?? null),
    lockJoining: () => Promise.resolve(window.__riders ?? null),
    newJoinCode: () => Promise.resolve(window.__riders ?? null),
  };
`;

async function riders(n: number): Promise<Rig> {
  const r = await started();
  for (let i = 1; i <= n; i++) r.socket().server({ v: 1, type: "rider_joined", rider: `rider${String(i).padStart(6, "0")}`, nickname: `Rider ${i}` });
  return r;
}

async function states(): Promise<Shot[]> {
  return [
    { name: "class-riders-closed", rig: await riders(3), act: [] },
    { name: "class-riders-open", rig: await riders(3), act: ["#riders-toggle"] },
    { name: "class-riders-full", rig: await riders(MAX_RIDERS), act: ["#riders-toggle"] },
    { name: "class-confirm-remove", rig: await riders(3), act: ["#riders-toggle", '[aria-label="Remove Rider 2"]'] },
  ];
}

async function open(size: readonly [number, number], s: Shot): Promise<{ page: Page; context: BrowserContext; external: string[]; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(STUB);
  const data = { __state: s.rig.controller.snapshot(), __pairing: PAIRED, __live: s.rig.live.view(), __riders: s.rig.live.riders() };
  await context.addInitScript(`Object.assign(window, ${JSON.stringify(data)});`);
  const page = await context.newPage();
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => void (r.url().startsWith("file:") || external.push(r.url())));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => void (m.type() === "error" && errors.push(m.text())));
  await page.goto(`file://${join(APP_DIR, "dist", "presenter.html")}`);
  await page.waitForSelector("#riders:not([hidden])");
  for (const sel of s.act) await page.click(sel);
  await page.waitForTimeout(100);
  return { page, context, external, errors };
}

interface Floors {
  readonly cap: string[];
  readonly contrast: string[];
  readonly cut: string[];
  readonly hue: string[];
  readonly short: string[];
  readonly sheets: string[];
  readonly sideways: boolean;
  readonly riders: { top: number; bottom: number };
  readonly reading: number;
  /** With the drawer open: its fixed parts' foot, the list's visible height, whether the column scrolls. */
  readonly drawer: { foot: number; list: number; columnScrolls: boolean } | null;
}

/** Measures every drawn element against the floors. */
const measure = (page: Page): Promise<Floors> =>
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
      return {
        ...out,
        sheets: [...document.styleSheets].map((s) => s.href ?? "inline"),
        sideways: document.scrollingElement!.scrollWidth > innerWidth,
        riders: { top: row.top, bottom: row.bottom },
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

let browser: Browser;
let shots: Shot[];
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;

before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await launchChrome();
  shots = await states();
});
after(async () => {
  await browser?.close();
});

test("with a class open, every panel meets S1 to S6 at 1000x720 and 1280x800", { timeout: 240_000 }, async () => {
  const sheet = `file://${join(APP_DIR, "dist", "presenter.css")}`;
  for (const s of shots) {
    for (const size of SIZES) {
      const name = `${s.name}-${size[0]}x${size[1]}`;
      if (only && !only.test(name)) continue;
      const o = await open(size, s);
      try {
        await o.page.screenshot({ path: join(SHOT_DIR, `presenter-style-${name}.png`), animations: "disabled" });
        const m = await measure(o.page);
        assert.deepEqual(m.sheets, [sheet], `${name}: the one bundled sheet`);
        assert.deepEqual(m.cap, [], `${name}: S1 cap heights`);
        assert.ok(m.reading >= CAP_READING, `${name}: S1 the riders count ${m.reading}`);
        assert.deepEqual(m.contrast, [], `${name}: S2 contrast`);
        assert.equal(m.sideways, false, `${name}: S3 no sideways scroll`);
        assert.deepEqual(m.cut, [], `${name}: S3 no cut text`);
        assert.ok(m.riders.top >= 0 && m.riders.bottom <= size[1] + 0.5, `${name}: S4 the riders row in view ${JSON.stringify(m.riders)}`);
        if (m.drawer) {
          // riders-panel.md P3 and P8: the head, both actions and the note in view with room for at
          // least 4 rows of 52 px, and nothing scrolls but the list.
          assert.ok(m.drawer.foot <= size[1], `${name}: S4 the drawer's head, actions and note in view`);
          assert.ok(m.drawer.list >= 4 * 52, `${name}: S4 room for 4 rows, ${m.drawer.list}`);
          assert.equal(m.drawer.columnScrolls, false, `${name}: only the list scrolls`);
        }
        assert.deepEqual(m.hue, [], `${name}: S5 no hue`);
        assert.deepEqual(m.short, [], `${name}: S6 buttons at least ${CONTROL_HEIGHT} px`);
        assert.deepEqual(o.external, [], `${name}: requests left the file system`);
        assert.deepEqual(o.errors, [], `${name}: page errors`);
      } finally {
        await o.context.close();
      }
    }
  }
});

test("the policy refuses any style but the bundled sheet: an injected <style> and a style attribute do nothing", { timeout: 60_000 }, async () => {
  const o = await open([1280, 800], shots[0]!);
  try {
    const before = await o.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(before, "rgb(0, 0, 0)", "the sheet applies");
    const after = await o.page.evaluate(async () => {
      const style = document.createElement("style");
      style.textContent = "body { background: rgb(255, 0, 0) !important; }";
      document.head.append(style);
      document.getElementById("riders")!.setAttribute("style", "color: rgb(255, 0, 0) !important");
      await new Promise((r) => setTimeout(r, 50));
      return { body: getComputedStyle(document.body).backgroundColor, riders: getComputedStyle(document.getElementById("riders")!).color };
    });
    assert.equal(after.body, "rgb(0, 0, 0)", "an injected <style> is refused");
    assert.notEqual(after.riders, "rgb(255, 0, 0)", "a style attribute is refused");
    assert.ok(o.errors.some((e) => /style-src/.test(e)), "the refusal is the policy's");
    assert.deepEqual(o.external, []);
  } finally {
    await o.context.close();
  }
});
