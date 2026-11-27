// The presenter's style (#682; presenter.md, riders-panel.md, sensors.md part 2) on the real page
// (dist/presenter.html) in headless Chrome, with a class open, at 1000x720 and 1280x800: the
// readability floors S1 to S6 measured on what is drawn, and the page's style coming only from its
// own bundled sheet (an injected <style> or style attribute is refused by the policy). The views
// come from the real controller and live client over the fake relay. No Electron, no network.
// Screenshots go to screenshots/ for the Designer. Needs `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { MAX_RIDERS } from "../../src/core/live/riders-model.ts";
import { musicNoticeOf } from "../../src/core/music-files/music-notice.ts";
import type { MusicNotice } from "../../src/core/music-files/music-notice.ts";
import { PAIRED } from "../unit/list-fixtures.ts";
import { started } from "../unit/live-relay.ts";
import type { Rig } from "../unit/live-relay.ts";
import { CAP_READING, CONTROL_HEIGHT, measure } from "./floors.ts";
import { APP_DIR, launchChrome, SHOT_DIR } from "./page.ts";

const SIZES: readonly (readonly [number, number])[] = [[1000, 720], [1280, 800]];

interface Shot {
  readonly name: string;
  readonly rig: Rig;
  /** Buttons pressed after the page loads. */
  readonly act: readonly string[];
  /** The music files notice the shell would put on the snapshot (core/music-files/music-notice.ts). */
  readonly music?: MusicNotice | null;
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
    // The instructor's music files (docs/design/music-files.md, "Presenter window, during a class"), in the words the shell makes.
    { name: "music-stopped", rig: await riders(3), act: [], music: musicNoticeOf({ reason: "failed" }, { song: 0, why: "read" }, "Neon Avenue") },
    { name: "music-length", rig: await riders(3), act: [], music: musicNoticeOf({ reason: "failed" }, { song: 0, why: "length" }, "Neon Avenue") },
    { name: "music-closed", rig: await riders(3), act: ["#music-close"], music: musicNoticeOf({ reason: "failed" }, { song: 0, why: "read" }, "Neon Avenue") },
    { name: "music-missing-at-start", rig: await riders(3), act: [], music: musicNoticeOf({ reason: "missing", missing: [1, 4] }, null, null) },
  ];
}

async function open(size: readonly [number, number], s: Shot): Promise<{ page: Page; context: BrowserContext; external: string[]; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(STUB);
  const data = { __state: { ...s.rig.controller.snapshot(), music: s.music ?? null }, __pairing: PAIRED, __live: s.rig.live.view(), __riders: s.rig.live.riders() };
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
        // sensors.md part 2: the sensors row sits above the riders row and, closed, is at most 100 px.
        assert.ok(m.sensors.bottom <= m.riders.top + 0.5, `${name}: S4 the sensors row above the riders row ${JSON.stringify(m.sensors)}`);
        if (!m.sensors.open && !m.drawer) assert.ok(m.sensors.bottom - m.sensors.top <= 100, `${name}: the sensors row at most 100 px`);
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
