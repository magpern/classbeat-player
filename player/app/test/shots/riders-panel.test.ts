// The presenter's riders panel (#366; riders-panel.md) in each of its states, on the real presenter
// page (dist/presenter.html) in headless Chrome. The views come from the real live client over the
// fake relay (test/unit/live-relay.ts); the page gets them through a stand-in for the shell's bridge
// that records what it is asked. Screenshots go to screenshots/ for the Designer. No Electron, no
// network. Needs `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { RidersView } from "../../src/core/live/riders-view.ts";
import { MAX_RIDERS, NEW_CODES_PER_HOUR } from "../../src/core/live/riders-model.ts";
import { ASK_CODE_MS, ASK_REMOVE_MS } from "../../src/renderer/riders-panel.ts";
import { PAIRED } from "../unit/list-fixtures.ts";
import { rig, started } from "../unit/live-relay.ts";
import type { Rig } from "../unit/live-relay.ts";
import { APP_DIR, launchChrome, SHOT_DIR } from "./page.ts";

const SIZES: readonly (readonly [number, number])[] = [[1280, 800], [1000, 720]];
const id = (n: number): string => `rider${String(n).padStart(6, "0")}`;
const LONG = ["WWWWWWWWWWWWWWWWWWWWWWWW", "Supercalifragilisticexpi", "Sam", "Sam", "<b>bold</b>", "."];

/** What the page does after it loads: buttons it presses, in order. */
type Act = readonly string[];

interface Shot {
  readonly name: string;
  readonly view: RidersView;
  readonly state: unknown;
  readonly act: Act;
  /** Text the state must show. */
  readonly expect: readonly string[];
}

function join3(r: Rig, names: readonly string[]): Rig {
  names.forEach((n, i) => r.socket().server({ v: 1, type: "rider_joined", rider: id(i + 1), nickname: n }));
  return r;
}

const OPEN = ["#riders-toggle"];
const shot = (name: string, r: Rig, act: Act, expect: readonly string[] = []): Shot => ({ name, view: r.live.riders(), state: r.controller.snapshot(), act, expect });

async function states(): Promise<Shot[]> {
  const out: Shot[] = [];
  const three = ["Anna", "Bo", "Carlos"];
  out.push(shot("closed", join3(await started(), three), [], ["3", "Riders", "Show list"]));
  out.push(shot("open", join3(await started(), three), OPEN, ["Hide list", "Anna", "Bo", "Carlos", "Lock joining", "New code"]));
  out.push(shot("confirm-remove", join3(await started(), three), [...OPEN, '[aria-label="Remove Bo"]'], ["Remove Bo from the class?", "Keep"]));
  const locked = join3(await started(), three);
  locked.live.lock(true);
  locked.socket().server({ v: 1, type: "lock_state", locked: true });
  out.push(shot("locked", locked, OPEN, ["Locked", "Unlock joining", "Joining is locked. Riders already in stay."]));
  out.push(shot("confirm-new-code", join3(await started(), three), [...OPEN, "#riders-new"], ["Make a new code?", "Make new code", "Cancel"]));
  const made = join3(await started(), three);
  made.live.newJoinCode();
  made.socket().server({ v: 1, type: "join_code", code: "KXPD-RMTB" });
  out.push(shot("new-code-made", made, OPEN, ["New code KXPD-RMTB. The room screen shows it now."]));
  const limit = join3(await started(), three);
  for (let i = 0; i < NEW_CODES_PER_HOUR; i++) {
    limit.live.newJoinCode();
    await limit.advance(1000);
  }
  out.push(shot("new-code-limit", limit, OPEN, ["10 an hour, used up"]));
  out.push(shot("empty", await started(), OPEN, ["No riders yet. Riders scan the QR code on the room screen."]));
  out.push(shot("off", rig(), [], ["Join codes are off", "Turn on join codes"]));
  const away = join3(await started(), three);
  away.socket().drop(1006);
  out.push(shot("reconnecting", away, OPEN, ["Reconnecting", "Reconnecting. The list comes back when the connection does."]));
  out.push(shot("full", join3(await started(), Array.from({ length: MAX_RIDERS }, (_, i) => `Rider ${i + 1}`)), OPEN, ["Full", "The class is full. More riders cannot join.", "Rider 60"]));
  out.push(shot("long-names", join3(await started(), LONG), OPEN, LONG));
  return out;
}

const STUB = `
  window.__calls = [];
  const rec = (name) => (...a) => { window.__calls.push([name, ...a]); return Promise.resolve(window.__riders ?? null); };
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
    startLive: rec("startLive"),
    endLive: () => Promise.resolve(window.__live ?? null),
    makeControlCode: () => Promise.resolve(window.__live ?? null),
    dropPhone: () => Promise.resolve(window.__live ?? null),
    riders: () => Promise.resolve(window.__riders ?? null),
    dropRider: rec("dropRider"),
    lockJoining: rec("lockJoining"),
    newJoinCode: rec("newJoinCode"),
  };
`;

interface Opened {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly external: string[];
  readonly errors: string[];
  calls(): Promise<unknown[][]>;
}

async function open(size: readonly [number, number], s: Shot, clock = false): Promise<Opened> {
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(STUB);
  await context.addInitScript(`window.__state = ${JSON.stringify(s.state)}; window.__pairing = ${JSON.stringify(PAIRED)}; window.__riders = ${JSON.stringify(s.view)};`);
  const page = await context.newPage();
  if (clock) await page.clock.install();
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => void (r.url().startsWith("file:") || external.push(r.url())));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => void (m.type() === "error" && errors.push(m.text())));
  await page.goto(`file://${join(APP_DIR, "dist", "presenter.html")}`);
  await page.waitForSelector("#riders:not([hidden])");
  return { page, context, external, errors, calls: () => page.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls) };
}

/** No colour anywhere in the panel: every colour and background is a grey. */
const hues = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const el of [document.getElementById("riders")!, ...document.querySelectorAll("#riders *")]) {
      const cs = getComputedStyle(el);
      for (const c of [cs.color, cs.backgroundColor, cs.borderTopColor]) {
        const m = c.match(/[\d.]+/g)?.map(Number) ?? [];
        if (m.length >= 3 && (Math.abs(m[0]! - m[1]!) > 2 || Math.abs(m[1]! - m[2]!) > 2)) out.push(`${el.id || el.tagName} ${c}`);
      }
    }
    return out;
  });

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

test("the riders panel in each state: the count, the nicknames as text in join order, no ranking, no colour", { timeout: 240_000 }, async () => {
  assert.deepEqual(
    shots.map((s) => s.name),
    ["closed", "open", "confirm-remove", "locked", "confirm-new-code", "new-code-made", "new-code-limit", "empty", "off", "reconnecting", "full", "long-names"],
  );
  for (const s of shots) {
    for (const size of SIZES) {
      const name = `${s.name}-${size[0]}x${size[1]}`;
      if (only && !only.test(name)) continue;
      const o = await open(size, s);
      try {
        const { page } = o;
        for (const sel of s.act) await page.click(sel);
        await page.waitForTimeout(100);
        await page.locator("#riders").scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(SHOT_DIR, `presenter-riders-${name}.png`), fullPage: true, animations: "disabled" });
        const panel = (await page.textContent("#riders")) ?? "";
        for (const t of s.expect) assert.ok(panel.includes(t), `${name}: shows ${t}`);
        assert.equal((await page.textContent("#riders-count"))?.trim(), s.view.count, `${name}: the count`);
        const drawn = await page.evaluate(() => ({
          open: !document.getElementById("riders-drawer")!.hidden,
          ol: document.querySelectorAll("#riders ol, #riders table, #riders progress, #riders meter, #riders svg, #riders canvas, #riders img").length,
          injected: document.querySelectorAll("#riders-list b, #riders-list li > *:not(span):not(button)").length,
          names: [...document.querySelectorAll("#riders-list > li")].map((li) => (li.querySelector("span[dir=auto]")?.textContent ?? "")),
          labels: [...document.querySelectorAll("#riders-list > li button[aria-label]")].map((b) => b.getAttribute("aria-label")),
          nameStyle: [...document.querySelectorAll("#riders-list span[dir=auto]")].every((n) => n.children.length === 0),
        }));
        assert.equal(drawn.ol, 0, `${name}: a plain list, no figure per rider`);
        assert.equal(drawn.injected, 0, `${name}: nicknames are text only`);
        assert.ok(drawn.nameStyle, `${name}: a name holds text only`);
        if (drawn.open) {
          const rows = s.view.rows.map((r) => r.nickname);
          if (s.name === "confirm-remove") assert.deepEqual(drawn.names, ["Anna", "Remove Bo from the class?", "Carlos"], name);
          else {
            assert.deepEqual(drawn.names, rows, `${name}: the rows in join order`);
            assert.deepEqual(drawn.labels, rows.map((n) => `Remove ${n}`), `${name}: each Remove names its rider`);
          }
        }
        assert.deepEqual(await hues(page), [], `${name}: no hue in the panel`);
        assert.deepEqual(o.external, [], `${name}: requests left the file system`);
        assert.deepEqual(o.errors, [], `${name}: page errors`);
      } finally {
        await o.context.close();
      }
    }
  }
  const by = new Map(shots.map((s) => [s.name, s.view]));
  assert.equal(by.get("full")!.rows.length, MAX_RIDERS);
  assert.equal(by.get("reconnecting")!.active, false);
  assert.equal(by.get("new-code-limit")!.canNewCode, false);
  assert.equal(by.get("off")!.count, "–");
});

test("Remove, Lock and New code ask the shell exactly once each; Esc and the time limits answer Keep and Cancel", { timeout: 60_000 }, async () => {
  const s = shots.find((x) => x.name === "open")!;
  const o = await open([1280, 800], s, true);
  try {
    const { page } = o;
    await page.click("#riders-toggle");
    // Remove asks first; Keep, Esc, a press elsewhere and 5 s all keep the rider.
    await page.click('[aria-label="Remove Bo"]');
    await page.click("li[data-asking] button:text-is(\"Keep\")");
    await page.click('[aria-label="Remove Bo"]');
    await page.keyboard.press("Escape");
    await page.click('[aria-label="Remove Bo"]');
    await page.click("#riders-note");
    await page.click('[aria-label="Remove Bo"]');
    await page.clock.runFor(ASK_REMOVE_MS + 10);
    assert.equal(await page.locator("li[data-asking]").count(), 0);
    assert.deepEqual(await o.calls(), []);
    await page.click('[aria-label="Remove Bo"]');
    await page.click("li[data-asking] button:text-is(\"Remove\")");
    // New code asks first; Cancel, Esc and 8 s make no code.
    await page.click("#riders-new");
    await page.click("#riders-new-no");
    await page.click("#riders-new");
    await page.keyboard.press("Escape");
    await page.click("#riders-new");
    await page.clock.runFor(ASK_CODE_MS + 10);
    assert.equal(await page.isHidden("#riders-ask-code"), true);
    await page.click("#riders-new");
    await page.click("#riders-new-yes");
    await page.click("#riders-lock");
    assert.deepEqual(await o.calls(), [["dropRider", id(2)], ["newJoinCode"], ["lockJoining", true]]);
    assert.deepEqual(o.errors, []);
  } finally {
    await o.context.close();
  }
});

test("the replay replaces the list and Lock acts again as lock_state says", { timeout: 60_000 }, async () => {
  const r = join3(await started(), ["Anna", "Bo", "Carlos"]);
  r.socket().drop(1006);
  const lost = r.live.riders();
  const o = await open([1280, 800], { name: "replay", view: lost, state: r.controller.snapshot(), act: [], expect: [] });
  try {
    const { page } = o;
    await page.click("#riders-toggle");
    assert.equal(await page.isDisabled("#riders-lock"), true);
    assert.equal(await page.getAttribute("#riders-drawer", "data-dim"), "true");
    const first = r.socket();
    await r.advance(30_000);
    const socket = r.socket();
    assert.notEqual(socket, first);
    socket.open();
    socket.server({ v: 1, type: "welcome", role: "host" });
    socket.server({ v: 1, type: "rider_joined", rider: id(3), nickname: "Carlos" });
    socket.server({ v: 1, type: "rider_joined", rider: id(1), nickname: "Anna" });
    socket.server({ v: 1, type: "lock_state", locked: true });
    const back = r.live.riders();
    assert.deepEqual(back.rows.map((x) => x.nickname), ["Carlos", "Anna"]);
    await page.evaluate((v) => void ((window as unknown as { __riders: unknown }).__riders = v), back);
    await page.waitForFunction(() => document.querySelectorAll("#riders-list > li").length === 2);
    assert.deepEqual(await page.locator("#riders-list span[dir=auto]").allTextContents(), ["Carlos", "Anna"]);
    assert.equal(await page.isDisabled("#riders-lock"), false);
    assert.equal((await page.textContent("#riders-lock-text"))?.trim(), "Unlock joining");
    await page.click("#riders-lock");
    assert.deepEqual(await o.calls(), [["lockJoining", false]]);
  } finally {
    await o.context.close();
  }
});
