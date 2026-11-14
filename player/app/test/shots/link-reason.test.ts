// The presenter's follow status with each reason the macOS reader gives for having no reading
// (#465), on the real presenter page (dist/presenter.html) in headless Chrome. The snapshots come
// from the real controller over the real macOS reader with a fake execFile and clock; the page gets
// them through a stand-in for the shell's bridge. Screenshots go to screenshots/ for the Designer.
// No Electron, no network. Needs `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<reason>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { describeReason } from "../../src/core/link/macos-reason.ts";
import type { NoReadingReason } from "../../src/core/link/reader.ts";
import { MAC_PROMPT_WAIT_MS, MAC_TIMEOUT_MS } from "../../src/core/link/macos-scripts.ts";
import type { Snapshot } from "../../src/core/snapshot.ts";
import { createController } from "../../src/main/controller.ts";
import { createMacMusic } from "../../src/main/macos-reader.ts";
import { converterExamples } from "../unit/fixtures.ts";
import { APP_DIR, launchChrome, SHOT_DIR } from "./page.ts";

const SIZES: readonly (readonly [number, number])[] = [[1280, 800], [1000, 720]];
const text = readFileSync(converterExamples()[0], "utf8");

const failure = (message: string): Error => Object.assign(new Error(message), { code: 1 });

/** The follow status after the reader gave this reason, through the real controller and reader. */
function snapshotFor(reason: NoReadingReason): Snapshot {
  const clock = { t: 0 };
  let done: (error: Error | null, out: string) => void = () => undefined;
  const mac = createMacMusic({
    exec: (_file, _args, _options, cb) => void (done = cb),
    now: () => clock.t,
    every: () => () => undefined,
  });
  const c = createController(() => clock.t, mac, mac);
  c.open("thursday.json", text);
  c.command({ type: "follow" });
  switch (reason) {
    case "waiting-for-permission":
      clock.t = MAC_TIMEOUT_MS + 1;
      break;
    case "not-answering":
      clock.t = MAC_PROMPT_WAIT_MS + 1;
      break;
    case "not-permitted":
      done(failure("Not authorized to send Apple events to Spotify. (-1743)"), "");
      break;
    case "not-running":
      done(null, "notrunning\n");
      break;
    case "script-failed":
      done(failure("syntax error (-2741)"), "");
      break;
  }
  const snap = c.snapshot();
  assert.equal(snap.link?.noReading, reason);
  return snap;
}

const STUB = `
  window.player = {
    getState: () => Promise.resolve(window.__state),
    command: () => Promise.resolve(window.__state),
    openDropped: () => Promise.resolve(window.__state),
    onUpdate: () => undefined,
    startPairing: () => Promise.resolve(null),
    pairingState: () => Promise.resolve(null),
    reopenPairingPage: () => Promise.resolve(null),
    unpair: () => Promise.resolve(null),
    liveView: () => Promise.resolve(null),
    startLive: () => Promise.resolve(null),
    endLive: () => Promise.resolve(null),
    makeControlCode: () => Promise.resolve(null),
    dropPhone: () => Promise.resolve(null),
    riders: () => Promise.resolve(null),
    dropRider: () => Promise.resolve(null),
    lockJoining: () => Promise.resolve(null),
    newJoinCode: () => Promise.resolve(null),
  };
`;

const REASONS: readonly NoReadingReason[] = ["waiting-for-permission", "not-permitted", "not-running", "not-answering", "script-failed"];

let browser: Browser;
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;

before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

test("the follow status gives the reason there is no reading, in each case", { timeout: 180_000 }, async () => {
  for (const reason of REASONS) {
    const state = snapshotFor(reason);
    for (const size of SIZES) {
      const name = `${reason}-${size[0]}x${size[1]}`;
      if (only && !only.test(name)) continue;
      const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, reducedMotion: "reduce" });
      try {
        await context.addInitScript("globalThis.__name = (f) => f;");
        await context.addInitScript(STUB);
        await context.addInitScript(`window.__state = ${JSON.stringify(state)};`);
        const page = await context.newPage();
        const external: string[] = [];
        const errors: string[] = [];
        page.on("request", (r) => void (r.url().startsWith("file:") || external.push(r.url())));
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`file://${join(APP_DIR, "dist", "presenter.html")}`);
        await page.waitForSelector("#link-reason:not([hidden])");
        await page.waitForTimeout(100);
        await page.locator("#link").scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(SHOT_DIR, `presenter-link-reason-${name}.png`), fullPage: true, animations: "disabled" });
        assert.equal((await page.textContent("#link-reason"))?.trim(), describeReason(reason), name);
        assert.deepEqual(external, [], `${name}: requests left the file system`);
        assert.deepEqual(errors, [], `${name}: page errors`);
      } finally {
        await context.close();
      }
    }
  }
});

test("with a reading there is no reason on the page", { timeout: 60_000 }, async () => {
  const withLink = snapshotFor("not-running");
  assert.ok(withLink.link !== null);
  const quiet: Snapshot = { ...withLink, link: { ...withLink.link, noReading: null } };
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    await context.addInitScript("globalThis.__name = (f) => f;");
    await context.addInitScript(STUB);
    await context.addInitScript(`window.__state = ${JSON.stringify(quiet)};`);
    const page = await context.newPage();
    await page.goto(`file://${join(APP_DIR, "dist", "presenter.html")}`);
    await page.waitForSelector("#link:not([hidden])");
    assert.equal(await page.isHidden("#link-reason"), true);
  } finally {
    await context.close();
  }
});
