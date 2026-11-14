// The presenter's phone-remote panel (#173) in each of its states, on the real presenter page
// (dist/presenter.html) in headless Chrome. The views come from the real live client over the fake
// relay (test/unit/live-relay.ts); the page gets them through a stand-in for the shell's bridge.
// Screenshots go to screenshots/ for the Designer. No Electron, no network. Needs `npm run build`.
// The control link's QR code (#201) is read back from where it is drawn on the page (which of its
// modules hit the dark path) and must give exactly the address the panel shows.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";
import type { LivePanelView } from "../../src/core/live/panel-view.ts";
import { PAIRED } from "../unit/list-fixtures.ts";
import { CONTROL_CODE, rig, started } from "../unit/live-relay.ts";
import type { Rig } from "../unit/live-relay.ts";
import { decodeQr } from "../unit/qr-decode.ts";
import { APP_DIR, launchChrome, SHOT_DIR } from "./page.ts";

const SIZES: readonly (readonly [number, number])[] = [[1280, 800], [1000, 720]];

interface Shot {
  readonly name: string;
  readonly view: LivePanelView;
  readonly state: unknown;
}

const shot = (name: string, r: Rig): Shot => ({ name, view: r.live.view(), state: r.controller.snapshot() });

async function states(): Promise<Shot[]> {
  const out: Shot[] = [];
  out.push(shot("off", rig()));
  // The start request still pending: End is offered and cancels it (#203).
  const starting = rig();
  starting.live.start();
  out.push(shot("starting", starting));
  const on = await started();
  out.push(shot("on", on));
  on.live.makeCode();
  on.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  out.push(shot("control-code", on));
  const used = await started();
  used.live.makeCode();
  used.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  used.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  used.socket().server({ v: 1, type: "code_cancelled", reason: "used" });
  out.push(shot("code-used", used));
  const ran = await started();
  ran.live.makeCode();
  ran.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  await ran.advance(120_000);
  out.push(shot("code-expired", ran));
  on.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  on.socket().server({ v: 1, type: "code_cancelled", reason: "used" });
  on.socket().server({ v: 1, type: "controller_joined", slot: 2, via: "sign_in" });
  on.controller.command({ type: "start" });
  await on.advance(1000);
  const state = on.socket().sent.filter((m) => (m as { type?: string }).type === "companion_state").at(-1) as { run: string; seq: number };
  on.socket().server({ v: 1, type: "command", slot: 1, id: "AAAAAAAAAAAAAAAAAAAAAQ", run: state.run, basis: state.seq, action: "pause" });
  out.push(shot("two-phones-line", on));
  const one = rig();
  one.secondDisplay = false;
  await started(one);
  out.push(shot("one-display", one));
  const away = await started();
  away.socket().drop(1006);
  out.push(shot("reconnecting", away));
  const ended = await started();
  ended.live.classChanged();
  out.push(shot("ended", ended));
  const full = rig();
  full.answer = { kind: "http", status: 409, body: { error: "sessions_full" }, retryAfterS: null };
  full.live.start();
  await full.advance(0);
  out.push(shot("refused", full));
  return out;
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
    liveView: () => Promise.resolve(window.__live),
    startLive: () => Promise.resolve(window.__live),
    endLive: () => Promise.resolve(window.__live),
    makeControlCode: () => Promise.resolve(window.__live),
    dropPhone: () => Promise.resolve(window.__live),
    riders: () => Promise.resolve(window.__riders ?? null),
    dropRider: () => Promise.resolve(window.__riders ?? null),
    lockJoining: () => Promise.resolve(window.__riders ?? null),
    newJoinCode: () => Promise.resolve(window.__riders ?? null),
  };
`;

/** The QR code as drawn: for each module's centre, whether the dark path is what is there. */
function readDrawn(): { side: number; dark: boolean[][] } | null {
  const svg = document.getElementById("live-qr-code");
  const box = document.getElementById("live-qr");
  if (!svg || !box || box.hidden) return null;
  const side = Number(svg.getAttribute("viewBox")?.split(" ")[2]);
  const r = svg.getBoundingClientRect();
  const m = r.width / side;
  const dark = Array.from({ length: side }, (_, y) => Array.from({ length: side }, (_, x) => document.elementFromPoint(r.left + (x + 0.5) * m, r.top + (y + 0.5) * m)?.id === "live-qr-dark"));
  return { side, dark };
}

/** The QR code is drawn exactly when the view has a link, and reads back to the address shown. */
async function checkQr(page: Page, view: LivePanelView, name: string): Promise<void> {
  const inDom = await page.locator("#live-qr-code").count();
  if (inDom > 0) await page.locator("#live-qr-code").scrollIntoViewIfNeeded();
  const drawn = await page.evaluate(readDrawn);
  if (view.controlLink === null) {
    assert.equal(drawn, null, `${name}: no QR code`);
    assert.equal(inDom, 0, `${name}: no QR code left in the page`);
    return;
  }
  assert.ok(drawn !== null, `${name}: the QR code is shown`);
  const quiet = 4;
  const ring = drawn.dark.flatMap((row, y) => row.filter((_, x) => x < quiet || y < quiet || x >= drawn.side - quiet || y >= drawn.side - quiet));
  assert.ok(ring.every((d) => !d), `${name}: the quiet zone is light`);
  const rows = drawn.dark.slice(quiet, drawn.side - quiet).map((row) => row.slice(quiet, drawn.side - quiet));
  const shownAddress = `${await page.textContent("#live-page-url")}#${await page.textContent("#live-class-code")}.${await page.textContent("#live-control-code")}`;
  assert.equal(decodeQr(rows).text, shownAddress, `${name}: the QR code reads back to the address shown`);
  assert.equal(shownAddress, view.controlLink);
  await page.locator("#live-qr-code").screenshot({ path: join(SHOT_DIR, `presenter-live-qr-${name}.png`), animations: "disabled" });
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

test("the phone-remote panel in each state: rendered, the control code only where it is offered", { timeout: 180_000 }, async () => {
  assert.deepEqual(
    shots.map((s) => s.name),
    ["off", "starting", "on", "control-code", "code-used", "code-expired", "two-phones-line", "one-display", "reconnecting", "ended", "refused"],
  );
  for (const s of shots) {
    for (const size of SIZES) {
      const name = `${s.name}-${size[0]}x${size[1]}`;
      if (only && !only.test(name)) continue;
      const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, reducedMotion: "reduce" });
      try {
        await context.addInitScript("globalThis.__name = (f) => f;");
        await context.addInitScript(STUB);
        await context.addInitScript(`window.__state = ${JSON.stringify(s.state)}; window.__pairing = ${JSON.stringify(PAIRED)}; window.__live = ${JSON.stringify(s.view)};`);
        const page = await context.newPage();
        const external: string[] = [];
        const errors: string[] = [];
        page.on("request", (r) => void (r.url().startsWith("file:") || external.push(r.url())));
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => void (m.type() === "error" && errors.push(m.text())));
        await page.goto(`file://${join(APP_DIR, "dist", "presenter.html")}`);
        await page.waitForSelector("#live:not([hidden])");
        await page.waitForTimeout(100);
        await page.locator("#live").scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(SHOT_DIR, `presenter-live-${name}.png`), fullPage: true, animations: "disabled" });
        const status = await page.textContent("#live-status");
        assert.equal(status?.trim(), s.view.status, name);
        const body = (await page.textContent("body")) ?? "";
        assert.equal(body.includes(CONTROL_CODE), s.view.controlCode !== null, `${name}: the control code shown only when offered`);
        if (s.view.line !== null) assert.ok(body.includes(s.view.line), `${name}: the phone's line`);
        if (s.view.canEnd) assert.equal((await page.textContent("#live-end"))?.trim(), s.view.endText, `${name}: the End button's words`);
        if (s.view.detail !== null) assert.ok(body.includes(s.view.detail), `${name}: the detail`);
        await checkQr(page, s.view, name);
        assert.deepEqual(external, [], `${name}: requests left the file system`);
        assert.deepEqual(errors, [], `${name}: page errors`);
      } finally {
        await context.close();
      }
    }
  }
  // The states show what they are for.
  const by = new Map(shots.map((s) => [s.name, s.view]));
  assert.equal(by.get("control-code")!.controlCode, CONTROL_CODE);
  assert.equal(by.get("one-display")!.controlCode, null);
  assert.ok(by.get("control-code")!.controlLink !== null);
  for (const n of ["code-used", "code-expired", "one-display", "two-phones-line"]) assert.equal(by.get(n)!.controlLink, null, n);
  assert.equal(by.get("code-used")!.codeNote, "Control code used");
  assert.equal(by.get("code-expired")!.canMakeCode, true);
  assert.equal(by.get("starting")!.canEnd, true);
  assert.equal(by.get("starting")!.endText, "Cancel");
  assert.equal(by.get("on")!.endText, "End phone remote");
  assert.equal(by.get("refused")!.detail, "Three phone remotes already run on this account: end one on that computer");
  assert.equal(by.get("two-phones-line")!.line, "Phone 1: pause");
  assert.deepEqual(
    by.get("two-phones-line")!.slots.map((x) => x.text),
    ["Phone 1: steering", "Phone 2: steering"],
  );
});

/** A rig whose control code is shown. */
async function withCode(): Promise<Rig> {
  const on = await started();
  on.live.makeCode();
  on.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  return on;
}

// An already drawn QR code is removed, not left behind, when the next view has no link (#201
// review): each way the code goes away, on one page that keeps polling, as the presenter does.
test("a drawn QR code goes from the page when the code is used, runs out, is dropped or the second display goes", { timeout: 60_000 }, async () => {
  const gone: [string, (r: Rig) => Promise<void>][] = [
    ["used", async (r) => void r.socket().server({ v: 1, type: "code_cancelled", reason: "used" })],
    ["expired", (r) => r.advance(120_000)],
    ["drop", async (r) => {
      r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "sign_in" });
      r.live.drop(1);
    }],
    ["one display", async (r) => void (r.secondDisplay = false)],
  ];
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  try {
    const first = await withCode();
    await context.addInitScript("globalThis.__name = (f) => f;");
    await context.addInitScript(STUB);
    await context.addInitScript(`window.__state = ${JSON.stringify(first.controller.snapshot())}; window.__pairing = ${JSON.stringify(PAIRED)}; window.__live = null;`);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`file://${join(APP_DIR, "dist", "presenter.html")}`);
    const serve = (v: LivePanelView): Promise<void> => page.evaluate((x) => void ((window as unknown as { __live: unknown }).__live = x), v);
    for (const [how, end] of gone) {
      const r = await withCode();
      const shown = r.live.view();
      assert.ok(shown.controlLink !== null, how);
      await serve(shown);
      await page.waitForSelector("#live-qr-code", { state: "attached" });
      // Drawing the same link again keeps the same node.
      await page.evaluate(() => void ((document.getElementById("live-qr-code") as unknown as { __mark: boolean }).__mark = true));
      await r.advance(1000);
      const again = r.live.view();
      assert.equal(again.controlLink, shown.controlLink, how);
      await serve(again);
      await page.waitForFunction((left) => document.getElementById("live-control-left")?.textContent === left, again.controlCodeLeft);
      assert.equal(await page.evaluate(() => (document.getElementById("live-qr-code") as unknown as { __mark?: boolean } | null)?.__mark), true, `${how}: the same node`);
      // The code goes away: the next view has no link.
      await end(r);
      const after = r.live.view();
      assert.equal(after.controlLink, null, how);
      assert.equal(after.controlCode, null, how);
      await serve(after);
      await page.waitForSelector("#live-control", { state: "hidden" });
      assert.equal(await page.locator("#live-qr-code").count(), 0, `${how}: the QR code is gone from the page`);
      assert.equal(await page.evaluate(() => document.getElementById("live-qr")!.hidden), true, `${how}: its box is hidden`);
      assert.ok(!((await page.textContent("body")) ?? "").includes(CONTROL_CODE), `${how}: the code's text is gone`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
