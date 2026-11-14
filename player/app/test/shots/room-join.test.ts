// The room screen's join sheet (#366; room-join.md) on the real room page in headless Chrome: before
// the start, a new code while it is open, J during the class, and the worst case (a 48-character
// site), at all ten sizes. Both QR codes are read back from where they are drawn and must give the
// riders' `/j#<code>` and the instructor's `/control#<code>` (J4); the codes are big enough (J2);
// nothing overlaps, is cut or reaches the band (J6); the sheet and the band's slot carry nothing about
// riders and no control code (J5); every code is the new one the frame after `join_code` (J7); no
// colour but the stage's greys and black on white (J4, C6). Screenshots go to screenshots/ for the
// Designer. No Electron, no network. Needs `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";
import { SHEET_LINE } from "../../src/core/room/band-view.ts";
import { PLATE_MS, SHEET_RUNNING_MS } from "../../src/core/room/join-sheet.ts";
import { controlAddress, joinAddress } from "../../src/core/room/remote.ts";
import type { RemoteView } from "../../src/core/room/remote.ts";
import { CONTROL_CODE, HOST_TOKEN } from "../unit/live-relay.ts";
import { decodeQr } from "../unit/qr-decode.ts";
import { qrCode } from "../../src/core/room/qr.ts";
import { encodeQr } from "../../src/core/qr/qr-encode.ts";
import { SHOT_DIR, launchChrome } from "./page.ts";
import { frameOf, JOIN, on, openRoom, SITE, wiggle } from "./room-page.ts";
import type { RoomOpen } from "./room-page.ts";

const ALL_SIZES: readonly (readonly [number, number])[] = [
  [2560, 1080], [1920, 1080], [1280, 720], [1680, 1050], [1280, 800],
  [1650, 1080], [1620, 1080], [1440, 1080], [1024, 768], [1280, 1024],
];
const NEW = "BCDF-GHJK";
/** room-join.md's worst case: a 48-character site address. */
const LONG_SITE = "https://indoor-cycling-studio-north-side.example";
/** The colours the sheet may use: the stage's tokens (web/src/design/tokens.css), black and white. */
const GREYS = new Set(["rgb(0, 0, 0)", "rgb(255, 255, 255)", "rgb(246, 244, 239)", "rgb(189, 186, 178)", "rgb(58, 58, 66)", "rgba(0, 0, 0, 0)"]);

let browser: Browser;
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;

before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

/** A QR code as drawn: for each module's centre, whether the dark path is what is there. */
async function readQr(page: Page, sel: string, address: string): Promise<boolean> {
  const drawn = await page.evaluate((sel) => {
    const svg = document.querySelector(sel);
    if (!svg) return null;
    const side = Number(svg.getAttribute("viewBox")?.split(" ")[2]);
    const r = svg.getBoundingClientRect();
    const m = r.width / side;
    const dark = Array.from({ length: side }, (_, y) => Array.from({ length: side }, (_, x) => {
      const hit = document.elementFromPoint(r.left + (x + 0.5) * m, r.top + (y + 0.5) * m);
      return hit?.tagName === "path" && hit.closest(sel) !== null;
    }));
    return { side, dark };
  }, sel);
  if (drawn === null) return false;
  const quiet = 4;
  const ring = drawn.dark.flatMap((row, y) => row.filter((_, x) => x < quiet || y < quiet || x >= drawn.side - quiet || y >= drawn.side - quiet));
  assert.ok(ring.every((d) => !d), `${sel}: the quiet zone is light`);
  const rows = drawn.dark.slice(quiet, -quiet).map((row) => row.slice(quiet, -quiet));
  // Version 3 (29 modules) where the address fits it; else the smallest version that does (J3).
  const v3 = qrCode(address);
  const want = v3?.modules ?? encodeQr(address).rows;
  if (v3 !== null) assert.equal(drawn.side, 37, `${sel}: 29 modules and the quiet zone`);
  assert.deepEqual(rows, want, `${sel}: the modules drawn are the code of ${address}`);
  // Error correction M (every code but a version 3 at L) is read back by the independent reader too.
  if (v3 === null || v3.level === "M") assert.equal(decodeQr(rows).text, address, `${sel}: reads back`);
  return true;
}

interface Layout {
  readonly vh: number;
  readonly box: { top: number; bottom: number; left: number; right: number };
  readonly riders: { w: number; h: number } | null;
  readonly instr: { w: number; h: number } | null;
  readonly overlaps: string[];
  readonly cut: string[];
  readonly bandTop: number | null;
  readonly colours: string[];
  readonly html: string;
}

const layout = (page: Page): Promise<Layout> =>
  page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>("section.join")!;
    const b = sheet.getBoundingClientRect();
    const size = (sel: string) => {
      const e = sheet.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    // Text and codes: none may cross another, and all lie inside the sheet.
    const parts = [...sheet.querySelectorAll("h1, h2, .how, .lbl, .code-big, .addr, .plate-new, svg")];
    const boxes = parts.map((e) => {
      const r = e.getBoundingClientRect();
      if (e.tagName === "svg") return { e, r: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } };
      // A text element: its lines' height (the block's), across its text's width only.
      const range = document.createRange();
      range.selectNodeContents(e);
      const t = range.getBoundingClientRect();
      return { e, r: { left: t.left, right: t.right, top: r.top, bottom: r.bottom } };
    });
    const name = (e: Element) => e.className && typeof e.className === "string" ? e.className : e.tagName;
    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!.r;
        const c = boxes[j]!.r;
        const inside = boxes[i]!.e.contains(boxes[j]!.e) || boxes[j]!.e.contains(boxes[i]!.e);
        if (!inside && a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) overlaps.push(`${name(boxes[i]!.e)} × ${name(boxes[j]!.e)}`);
      }
    const cut = boxes.filter(({ r }) => r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5).map(({ e }) => name(e));
    const band = document.querySelector<HTMLElement>(".band");
    const shown = band !== null && band.dataset.phase !== "hidden" && getComputedStyle(band).visibility !== "hidden" && Number(getComputedStyle(band).opacity) > 0;
    const colours = new Set<string>();
    for (const e of [sheet, ...sheet.querySelectorAll("*")]) {
      const cs = getComputedStyle(e);
      for (const c of [cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderLeftColor]) colours.add(c);
      for (const a of ["fill", "stroke"]) {
        const v = e.getAttribute(a);
        if (v) colours.add(v);
      }
    }
    return {
      vh: window.innerHeight / 100,
      box: { top: b.top, bottom: b.bottom, left: b.left, right: b.right },
      riders: size(".qr-riders"),
      instr: size(".qr-instr"),
      overlaps,
      cut,
      bandTop: shown ? band.getBoundingClientRect().top : null,
      colours: [...colours],
      html: new XMLSerializer().serializeToString(document),
    };
  });

/** The fill attributes are hex; the computed colours are rgb(). */
const greyOf = (c: string): string => (c === "#ffffff" ? "rgb(255, 255, 255)" : c === "#000000" ? "rgb(0, 0, 0)" : c === "none" ? "rgba(0, 0, 0, 0)" : c);

async function checkSheet(r: RoomOpen, size: readonly [number, number], name: string, site: string, code: string, old: string | null): Promise<void> {
  const { page } = r;
  assert.equal(await page.isVisible("section.join"), true, `${name}: the sheet shows`);
  const l = await layout(page);
  const wide = size[0] / size[1] >= 1.7;
  assert.ok(await readQr(page, "section.join svg.qr-riders", joinAddress(site, code)), `${name}: the riders QR code`);
  assert.ok(await readQr(page, "section.join svg.qr-instr", controlAddress(site, code)), `${name}: the instructor QR code`);
  // J2: big enough, square (a pixel of rounding).
  assert.ok(l.riders !== null && l.instr !== null);
  assert.ok(Math.abs(l.riders.w - l.riders.h) < 1 && Math.abs(l.instr.w - l.instr.h) < 1, `${name}: square`);
  assert.ok(l.riders.h >= (wide ? 48 : 36) * l.vh - 1, `${name}: the riders' QR code is ${l.riders.h / l.vh} vh`);
  assert.ok(l.instr.h >= (wide ? 24 : 20) * l.vh - 1, `${name}: the instructor's QR code is ${l.instr.h / l.vh} vh`);
  assert.deepEqual(l.overlaps, [], `${name}: nothing overlaps`);
  assert.deepEqual(l.cut, [], `${name}: nothing is cut`);
  if (l.bandTop !== null) assert.ok(l.bandTop - l.box.bottom >= 2 * l.vh - 1, `${name}: the sheet ends 2 vh above the band`);
  assert.equal((await page.textContent("section.join .code-big"))?.trim(), code, `${name}: the code as text`);
  // J5: no control code, no token, nothing about riders; the old code nowhere.
  for (const x of [CONTROL_CODE, HOST_TOKEN, "cbp_"]) assert.ok(!l.html.includes(x), `${name}: ${x} in the page`);
  if (old !== null) assert.ok(!l.html.includes(old), `${name}: the old code is gone`);
  const odd = l.colours.map(greyOf).filter((c) => !GREYS.has(c));
  assert.deepEqual(odd, [], `${name}: no hue on the sheet`);
  // The band's slot: no QR code while the sheet is open, and the line says J hides the codes.
  if (l.bandTop !== null) {
    assert.equal(await page.locator(".band svg.qr").count(), 0, `${name}: no QR code in the band`);
    assert.ok(((await page.textContent(".band")) ?? "").includes(SHEET_LINE), `${name}: ${SHEET_LINE}`);
  }
}

const shoot = (page: Page, state: string, size: readonly [number, number]): Promise<Buffer> =>
  page.screenshot({ path: join(SHOT_DIR, `room-join-${state}-${size[0]}x${size[1]}.png`), animations: "disabled" });

function sized(state: string, size: readonly [number, number]): string | null {
  const name = `${state}-${size[0]}x${size[1]}`;
  return only && !only.test(name) ? null : name;
}

const remoteOn = (site: string, code: string): RemoteView => ({ slot: "on", joinCode: code, phones: 0, reconnecting: false, site });

test("before the start the sheet shows both codes by itself; J closes and opens it", { timeout: 240_000 }, async () => {
  for (const size of ALL_SIZES) {
    const name = sized("before-start", size);
    if (name === null) continue;
    const r = await openRoom(browser, { size, frame: frameOf("before-start"), remote: on(), reducedMotion: true });
    try {
      await shoot(r.page, "before-start", size);
      await checkSheet(r, size, name, SITE, JOIN, null);
      await r.page.keyboard.press("j");
      await r.run(20);
      assert.equal(await r.page.isHidden("section.join"), true, `${name}: J closes it`);
      await r.page.keyboard.press("j");
      await r.run(20);
      assert.equal(await r.page.isVisible("section.join"), true, `${name}: J opens it again`);
      assert.deepEqual(await r.calls(), [], `${name}: J moves nothing`);
      assert.deepEqual([r.errors, r.external], [[], []]);
    } finally {
      await r.close();
    }
  }
});

test("a new code while the sheet is open: every code is the new one at once, with the plate for 10 s", { timeout: 240_000 }, async () => {
  for (const size of ALL_SIZES) {
    const name = sized("new-code", size);
    if (name === null) continue;
    const r = await openRoom(browser, { size, frame: frameOf("before-start"), remote: on(), reducedMotion: true });
    try {
      await r.pushRemote(remoteOn(SITE, NEW));
      await shoot(r.page, "new-code", size);
      assert.equal(await r.page.isVisible("section.join .plate-new"), true, `${name}: the plate`);
      await checkSheet(r, size, name, SITE, NEW, JOIN);
      await r.run(PLATE_MS + 50);
      assert.equal(await r.page.locator("section.join .plate-new").count(), 0, `${name}: the plate goes after 10 s`);
      assert.deepEqual([r.errors, r.external], [[], []]);
    } finally {
      await r.close();
    }
  }
});

test("during the class J opens the sheet for 20 s; a new code does not open it", { timeout: 240_000 }, async () => {
  for (const size of ALL_SIZES) {
    const name = sized("running", size);
    if (name === null) continue;
    const r = await openRoom(browser, { size, frame: frameOf("running"), remote: on(), reducedMotion: true });
    try {
      assert.equal(await r.page.isHidden("section.join"), true, `${name}: closed while the class runs`);
      await r.pushRemote(remoteOn(SITE, NEW));
      assert.equal(await r.page.isHidden("section.join"), true, `${name}: a new code does not open it`);
      await r.page.keyboard.press("j");
      await r.run(20);
      // The band up for the slot, as in the mock-up.
      await wiggle(r.page);
      await r.run(20);
      await shoot(r.page, "running", size);
      await checkSheet(r, size, name, SITE, NEW, JOIN);
      assert.equal(await r.page.locator("section.join .plate-new").count(), 0, `${name}: no plate for a code that came while closed`);
      await r.run(SHEET_RUNNING_MS);
      assert.equal(await r.page.isHidden("section.join"), true, `${name}: closed after 20 s`);
      assert.deepEqual(await r.calls(), [], `${name}: J moves nothing`);
      assert.deepEqual([r.errors, r.external], [[], []]);
    } finally {
      await r.close();
    }
  }
});

test("the worst case: a 48-character site and the plate; nothing is cut or covered", { timeout: 240_000 }, async () => {
  assert.equal(LONG_SITE.length, 48);
  for (const size of ALL_SIZES) {
    const name = sized("worst", size);
    if (name === null) continue;
    const r = await openRoom(browser, { size, frame: frameOf("worst-before-start"), remote: remoteOn(LONG_SITE, JOIN), reducedMotion: true });
    try {
      await r.pushRemote(remoteOn(LONG_SITE, NEW));
      await shoot(r.page, "worst", size);
      assert.equal(await r.page.isVisible("section.join .plate-new"), true, `${name}: the plate`);
      await checkSheet(r, size, name, LONG_SITE, NEW, JOIN);
      assert.deepEqual([r.errors, r.external], [[], []]);
    } finally {
      await r.close();
    }
  }
});
