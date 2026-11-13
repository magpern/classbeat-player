// The presenter's phone-remote panel (#173) in each of its states, on the real presenter page
// (dist/presenter.html) in headless Chrome. The views come from the real live client over the fake
// relay (test/unit/live-relay.ts); the page gets them through a stand-in for the shell's bridge.
// Screenshots go to screenshots/ for the Designer. No Electron, no network. Needs `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import type { LivePanelView } from "../../src/core/live/panel-view.ts";
import { PAIRED } from "../unit/list-fixtures.ts";
import { CONTROL_CODE, rig, started } from "../unit/live-relay.ts";
import type { Rig } from "../unit/live-relay.ts";
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
  };
`;

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
    ["off", "starting", "on", "control-code", "two-phones-line", "one-display", "reconnecting", "ended", "refused"],
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
  assert.equal(by.get("starting")!.canEnd, true);
  assert.equal(by.get("two-phones-line")!.line, "Phone 1: pause");
  assert.deepEqual(
    by.get("two-phones-line")!.slots.map((x) => x.text),
    ["Phone 1: steering", "Phone 2: steering"],
  );
});
