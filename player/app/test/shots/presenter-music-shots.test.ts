// The presenter's music line and plate in each state of docs/design/music-files.md ("Presenter window,
// during a class"; issue #975) on the real page (dist/presenter.html), in headless Chrome at 1000x720
// and 1280x800: a screenshot of each state for the Designer, the spec's words, the plate's measurable
// numbers (M1 headline and body, M5 words and a key, M7 key height), the presenter's readability floors,
// and nothing from the disk in what is drawn (M10). No Electron, no network. Needs `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { PAIRED } from "../unit/list-fixtures.ts";
import { started } from "../unit/live-relay.ts";
import { CAP_READING, CONTROL_HEIGHT, measure } from "./floors.ts";
import { APP_DIR, launchChrome, SHOT_DIR } from "./page.ts";
import { PRESENTER_MUSIC_STATES } from "./presenter-music-states.ts";
import type { PresenterMusicState } from "./presenter-music-states.ts";

const SIZES: readonly (readonly [number, number])[] = [[1000, 720], [1280, 800]];
/** Cap heights the spec's M1 asks of the plate: headline 12 px, body and details 10 px. */
const CAP_HEADLINE = 12;
const CAP_PLATE_TEXT = 10;

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

let browser: Browser;
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;
before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

interface Opened {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly external: string[];
  readonly errors: string[];
}

async function open(size: readonly [number, number], s: PresenterMusicState, running: boolean): Promise<Opened> {
  const rig = await started();
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(STUB);
  // The words test draws the spec's states while the class runs, so it starts the clock; the floors test measures the same notice
  // as the snapshot paints it and does not need the clock.
  if (running) rig.controller.command({ type: "start" });
  const data = { __state: { ...rig.controller.snapshot(), music: s.notice }, __pairing: PAIRED, __live: rig.live.view(), __riders: rig.live.riders() };
  await context.addInitScript(`Object.assign(window, ${JSON.stringify(data)});`);
  const page = await context.newPage();
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => void (r.url().startsWith("file:") || external.push(r.url())));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => void (m.type() === "error" && errors.push(m.text())));
  await page.goto(`file://${join(APP_DIR, "dist", "presenter.html")}`);
  await page.waitForSelector("#music:not([hidden])");
  for (const sel of s.act) await page.click(sel);
  await page.waitForTimeout(100);
  return { page, context, external, errors };
}

const text = (page: Page, id: string): Promise<string> => page.locator(`#${id}`).innerText();
const capOf = (page: Page, id: string): Promise<number> =>
  page.evaluate((i) => {
    const el = document.getElementById(i)!;
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText("H").actualBoundingBoxAscent;
  }, id);

/** Anything that looks like a path, a folder separator or a disk file name. */
const FROM_DISK = /[\\/]|\.(mp3|m4a|flac|wav|ogg|aac)\b|\.\./i;

test("each music state shows the spec's words, and its plate meets M1, M5 and M7", { timeout: 240_000 }, async () => {
  for (const s of PRESENTER_MUSIC_STATES) {
    for (const size of SIZES) {
      const name = `${s.name}-${size[0]}x${size[1]}`;
      if (only && !only.test(name)) continue;
      const o = await open(size, s, true);
      try {
        await o.page.screenshot({ path: join(SHOT_DIR, `presenter-music-${name}.png`), animations: "disabled" });
        // The spec's first line: the class is running. The page writes the clock's own word, "Running".
        assert.equal(await text(o.page, "status"), "Running", `${name}: the status line`);
        assert.equal(await text(o.page, "music-line"), s.line, `${name}: the music line`);
        assert.equal(await text(o.page, "music-detail"), s.detail, `${name}: the detail`);
        const plate = o.page.locator("#music-plate");
        if (s.plate === null) {
          assert.equal(await plate.isHidden(), true, `${name}: no plate`);
        } else {
          assert.equal(await plate.isVisible(), true, `${name}: the plate shows`);
          assert.equal(await plate.getAttribute("role"), "status", `${name}: the plate is a polite status`);
          assert.equal(await text(o.page, "music-plate-headline"), s.plate.headline, `${name}: headline`);
          assert.equal(await text(o.page, "music-plate-body"), s.plate.body, `${name}: body`);
          // M5: the plate has its words and a key; M1: the headline and the body are readable; M7: the key is 44 px.
          assert.equal((await text(o.page, "music-close")).replace(/\s+/g, " ").trim(), "Close Esc", `${name}: the key`);
          assert.ok((await capOf(o.page, "music-plate-headline")) >= CAP_HEADLINE, `${name}: M1 headline cap height`);
          assert.ok((await capOf(o.page, "music-plate-body")) >= CAP_PLATE_TEXT, `${name}: M1 body cap height`);
          assert.ok((await o.page.locator("#music-close").boundingBox())!.height >= CONTROL_HEIGHT - 0.5, `${name}: M7 key height`);
        }
        assert.ok((await capOf(o.page, "music-detail")) >= CAP_PLATE_TEXT, `${name}: M1 detail cap height`);
        // M10: nothing from the disk in what is drawn.
        const drawn = await o.page.locator("#music").innerText();
        assert.doesNotMatch(drawn, FROM_DISK, `${name}: no path, folder or disk file name`);
        assert.deepEqual(o.external, [], `${name}: requests left the file system`);
        assert.deepEqual(o.errors, [], `${name}: page errors`);
      } finally {
        await o.context.close();
      }
    }
  }
});

test("each music state meets the presenter's readability floors at both sizes", { timeout: 240_000 }, async () => {
  for (const s of PRESENTER_MUSIC_STATES) {
    for (const size of SIZES) {
      const name = `${s.name}-${size[0]}x${size[1]}`;
      if (only && !only.test(name)) continue;
      const o = await open(size, s, false);
      try {
        const m = await measure(o.page);
        assert.deepEqual(m.cap, [], `${name}: S1 cap heights`);
        assert.ok(m.reading >= CAP_READING, `${name}: S1 the riders count ${m.reading}`);
        assert.deepEqual(m.contrast, [], `${name}: S2 contrast`);
        assert.equal(m.sideways, false, `${name}: S3 no sideways scroll`);
        assert.deepEqual(m.cut, [], `${name}: S3 no cut text`);
        assert.deepEqual(m.hue, [], `${name}: S5 no hue`);
        assert.deepEqual(m.short, [], `${name}: S6 buttons at least ${CONTROL_HEIGHT} px`);
        const music = await o.page.locator("#music").boundingBox();
        assert.ok(music !== null && music.y >= 0 && music.y + music.height <= size[1] + 0.5, `${name}: the music section in view`);
      } finally {
        await o.context.close();
      }
    }
  }
});

test("the disk check can fail: a path or a file name in the drawn words is caught", () => {
  for (const bad of ["C:\\Music\\a.mp3", "/home/me/Music", "neon_avenue_final_v2.mp3", "a/b"]) assert.match(bad, FROM_DISK, bad);
  for (const good of ["Neon Avenue could not be read. The clock keeps running.", "2 music files were missing when the class started"]) assert.doesNotMatch(good, FROM_DISK, good);
});
