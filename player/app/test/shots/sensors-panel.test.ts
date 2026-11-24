// The presenter's sensor panel (#664; docs/design/sensors.md part 2) in each state, in headless Chrome.
// The panel is the real renderer code on a fake source (harness), plus the real dist/presenter.html for
// the state the player ships in. Screenshots go to screenshots/ for the Designer. No Electron, no
// network, no Bluetooth. Needs `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import type { Browser, Page } from "playwright-core";
import { ZONE_HUES } from "../../src/core/sensors/zone-hue.ts";
import { TICK_FILL, TRACK_FILL } from "../../src/renderer/sensors-draw.ts";
import { APP_DIR, launchChrome, SHOT_DIR } from "./page.ts";

const SIZES: readonly (readonly [number, number])[] = [[1000, 720], [1280, 800]];
const T = 10_000;
const NEVER = /too high|too low|in range|target heart rate zone|adjust|push|ease off|go up|slow down|speed up/i;
const R = (value: number, at = T) => ({ value, at });
type Dev = { id: string; name: string; state: "connected" | "lost"; measures: string[]; readings: Record<string, { value: number; at: number }> };
const dev = (id: string, name: string, measures: string[], readings: Dev["readings"], state: Dev["state"] = "connected"): Dev => ({ id, name, state, measures, readings });
const STRAP = dev("h", "Polar H10 A1B2C3", ["heartRate"], { heartRate: R(142) });
const BIKE = dev("b", "Studio bike 7", ["power", "cadence"], { power: R(238), cadence: R(92) });
const IV = { start_ms: 0, length_ms: 60000, zone: 4, cadence: { from: 90, to: 100 }, cue: "x" };
const ZONE = { zone: 4, name: "Threshold", ftp_pct: [95, 105], hrmax_pct: [85, 92] };

interface Shot {
  readonly name: string;
  readonly snap: { state: string; devices: Dev[]; nearby: unknown[]; failed: string | null };
  readonly act: readonly string[];
  readonly numbers: boolean;
  readonly cadence?: { from: number; to: number };
  readonly expect: readonly string[];
  readonly gauges: number;
}
const snap = (state: string, devices: Dev[], nearby: unknown[] = [], failed: string | null = null) => ({ state, devices, nearby, failed });
const SHOTS: readonly Shot[] = [
  { name: "idle", snap: snap("idle", []), act: [], numbers: true, expect: ["Sensors", "Nothing connected", "Connect a sensor"], gauges: 0 },
  { name: "closed", snap: snap("connected", [STRAP, BIKE]), act: [], numbers: true, expect: ["Connected", "142 bpm", "238 W", "92 rpm", "Show"], gauges: 0 },
  { name: "closed-lost", snap: snap("lost", [STRAP, { ...BIKE, state: "lost" }]), act: [], numbers: true, expect: ["Sensor lost", "142 bpm", "– W", "– rpm"], gauges: 0 },
  { name: "open", snap: snap("connected", [STRAP, BIKE]), act: ["#sensors-toggle"], numbers: true, expect: ["Plan 157–170 bpm", "Plan 238–263 W", "Plan 90–100 rpm", "Heart rate, connected", "Power and cadence, connected", "Connect another sensor", "Readings stay on this computer. Nothing is sent, saved or compared."], gauges: 3 },
  { name: "open-missing", snap: snap("connected", [dev("h", "Polar H10 A1B2C3", ["heartRate"], { heartRate: R(142, T - 5000) }), BIKE]), act: ["#sensors-toggle"], numbers: true, expect: ["Heart rate, no reading", "Disconnect"], gauges: 3 },
  { name: "open-lost", snap: snap("lost", [{ ...STRAP, state: "lost" }, BIKE]), act: ["#sensors-toggle"], numbers: true, expect: ["Heart rate, lost", "Reconnect", "Sensor lost"], gauges: 3 },
  { name: "open-no-numbers", snap: snap("connected", [STRAP, BIKE]), act: ["#sensors-toggle"], numbers: false, expect: ["Plan 85–92 % of max", "Plan 95–105 % of FTP", "Type your FTP and max heart rate below to see the gauge."], gauges: 1 },
  { name: "choosing", snap: snap("choosing", [], [{ id: "1", name: "Polar H10 A1B2C3", services: ["heartRate"] }, { id: "2", name: "Studio bike 7", services: ["cyclingPower", "fitnessMachine"] }, { id: "3", name: "Headphones", services: [] }]), act: [], numbers: true, expect: ["Choosing…", "Looking for sensors. Wake yours.", "Polar H10 A1B2C3", "Heart rate", "Cycling power, Fitness machine", "Cancel"], gauges: 0 },
  { name: "failed", snap: snap("choosing", [], [{ id: "1", name: "Polar H10 A1B2C3", services: ["heartRate"] }], "Polar H10 A1B2C3"), act: [], numbers: true, expect: ["Could not connect to Polar H10 A1B2C3. Check that it is awake.", "Looking for sensors. Wake yours."], gauges: 0 },
  {
    name: "worst",
    snap: snap("connected", [dev("h", "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW", ["heartRate"], { heartRate: R(188) }), dev("b", "Studio bike with a very long name 0001", ["power", "cadence"], { power: R(1999), cadence: R(120) }), dev("c", "Second cadence sensor", ["cadence"], { cadence: R(80) })]),
    act: ["#sensors-toggle"], numbers: true, cadence: { from: 100, to: 110 }, expect: ["1999", "Plan 100–110 rpm", "connected, not used", "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW"], gauges: 3,
  },
];

let browser: Browser;
let dir: string;
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;

before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  dir = mkdtempSync(join(tmpdir(), "sensors-harness-"));
  await build({ entryPoints: [join(APP_DIR, "test", "shots", "sensors-harness.ts")], outfile: join(dir, "sensors-harness.js"), bundle: true, platform: "browser", format: "iife", target: "chrome130", logLevel: "warning" });
  const html = readFileSync(join(APP_DIR, "src", "renderer", "presenter.html"), "utf8").replace("presenter.js", "sensors-harness.js");
  writeFileSync(join(dir, "sensors.html"), html);
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

async function open(size: readonly [number, number], file: string, init = ""): Promise<{ page: Page; errors: string[]; external: string[]; close(): Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await context.addInitScript("globalThis.__name = (f) => f;");
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors: string[] = [];
  const external: string[] = [];
  page.on("request", (r) => void (r.url().startsWith("file:") || external.push(r.url())));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => void (m.type() === "error" && errors.push(m.text())));
  await page.goto(`file://${file}`);
  return { page, errors, external, close: () => context.close() };
}

const harness = (size: readonly [number, number]) => open(size, join(dir, "sensors.html"));
const drive = (page: Page, s: Shot) =>
  page.evaluate(
    ({ snap, iv, zone }) => {
      const w = window as unknown as { __fake: { set(p: unknown): void }; __sensors: { setPlan(p: unknown): void } };
      w.__sensors.setPlan({ interval: iv, zone });
      w.__fake.set(snap);
    },
    { snap: s.snap, iv: { ...IV, cadence: s.cadence ?? IV.cadence }, zone: ZONE },
  );

test("the panel in each state: numbers and a gauge against the plan, no hue but a band, no advice", { timeout: 240_000 }, async () => {
  for (const s of SHOTS) {
    for (const size of SIZES) {
      const name = `${s.name}-${size[0]}x${size[1]}`;
      if (only && !only.test(name)) continue;
      const o = await harness(size);
      try {
        const { page } = o;
        await page.waitForSelector("#sensors");
        await drive(page, s);
        for (const sel of s.act) await page.click(sel);
        // The two numbers are typed in the drawer, when it shows.
        if (s.numbers && (await page.isVisible("#sensors-ftp"))) {
          await page.fill("#sensors-ftp", "250");
          await page.fill("#sensors-hrmax", "185");
        }
        await page.waitForTimeout(150);
        await page.screenshot({ path: join(SHOT_DIR, `presenter-sensors-${name}.png`), fullPage: true, animations: "disabled" });
        const panel = (await page.textContent("#sensors")) ?? "";
        for (const t of s.expect) assert.ok(panel.includes(t), `${name}: shows ${t}`);
        assert.doesNotMatch(panel, NEVER, `${name}: no advice`);
        const d = await page.evaluate(() => {
          const svgs = [...document.querySelectorAll<SVGSVGElement>("#sensors svg")];
          const fills = (sel: string) => [...document.querySelectorAll(`#sensors svg ${sel}`)].map((e) => e.getAttribute("fill"));
          return {
            gauges: svgs.filter((v) => v.getClientRects().length > 0).length,
            roles: svgs.map((v) => [v.getAttribute("role"), v.getAttribute("aria-label")]),
            band: fills("[data-part=band]"),
            tick: fills("[data-part=tick]"),
            track: [...document.querySelectorAll("#sensors svg > rect:first-child")].map((e) => e.getAttribute("fill")),
            other: document.querySelectorAll("#sensors ol, #sensors table, #sensors canvas, #sensors img, #sensors progress, #sensors circle, #sensors path, #sensors [style]:not([style=\"\"])").length,
            storage: localStorage.length + sessionStorage.length,
            names: [...document.querySelectorAll("#sensors-devices > li > span[dir=auto]")].every((n) => n.children.length === 0),
          };
        });
        assert.equal(d.gauges, s.gauges, `${name}: gauges drawn`);
        for (const [role, label] of d.roles) {
          assert.equal(role, "meter", name);
          assert.match(label ?? "", /\d/, `${name}: a text alternative`);
        }
        const hues = Object.values(ZONE_HUES);
        assert.ok(d.band.every((f) => hues.includes(f ?? "")), `${name}: a band is the planned zone's hue`);
        assert.ok(d.tick.every((f) => f === TICK_FILL), `${name}: the tick is the same white everywhere`);
        assert.ok(d.track.every((f) => f === TRACK_FILL && !hues.includes(f)), `${name}: the track is no zone hue`);
        assert.equal(d.other, 0, `${name}: one straight gauge, no ring, no style`);
        assert.equal(d.storage, 0, `${name}: nothing stored`);
        assert.ok(d.names, `${name}: names are text only`);
        assert.deepEqual(o.external, [], `${name}: requests left the file system`);
        assert.deepEqual(o.errors, [], `${name}: page errors (the page has no shell bridge)`);
      } finally {
        await o.close();
      }
    }
  }
});

test("the state the player ships in: not available yet, no button, no drawer", { timeout: 60_000 }, async () => {
  for (const size of SIZES) {
    const o = await open(size, join(APP_DIR, "dist", "presenter.html"), "window.player = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => new Promise(() => {})) });");
    try {
      const { page } = o;
      await page.waitForSelector("#sensors");
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(SHOT_DIR, `presenter-sensors-unavailable-${size[0]}x${size[1]}.png`), fullPage: true, animations: "disabled" });
      assert.equal((await page.textContent("#sensors-state"))?.trim(), "Not available yet");
      assert.equal((await page.textContent("#sensors-line"))?.trim(), "Reading sensors on this computer is not set up yet.");
      for (const id of ["sensors-connect", "sensors-toggle", "sensors-drawer", "sensors-another", "sensors-live"]) assert.equal(await page.isVisible(`#${id}`), false, id);
      await page.keyboard.press("s");
      assert.equal(await page.isVisible("#sensors-drawer"), false, "no S key");
      assert.deepEqual(o.external, []);
      assert.deepEqual(o.errors, []);
    } finally {
      await o.close();
    }
  }
});

test("a reading changes nothing in the class: the panel never calls the shell and the page's own clock text stays", { timeout: 60_000 }, async () => {
  const o = await harness([1000, 720]);
  try {
    const { page } = o;
    await page.waitForSelector("#sensors");
    const s = SHOTS[3]!;
    await drive(page, s);
    // The harness has no `window.player`: any call from the panel would be a page error.
    for (let i = 0; i < 20; i++) {
      await page.evaluate((i) => {
        const w = window as unknown as { __fake: { read(id: string, m: string, v: number, at: number): void }; __setNow(t: number): void };
        w.__setNow(10_000 + i * 500);
        w.__fake.read("b", "cadence", 60 + i * 5, 10_000 + i * 500);
      }, i);
    }
    assert.deepEqual(await page.evaluate(() => Object.keys(window).filter((k) => k === "player")), []);
    assert.deepEqual(o.errors, []);
  } finally {
    await o.close();
  }
});

test("a shown number steps at most once a second; a lapsed one is a dash at once", { timeout: 60_000 }, async () => {
  const o = await harness([1000, 720]);
  try {
    const { page } = o;
    await page.waitForSelector("#sensors");
    await drive(page, SHOTS[1]!);
    const live = async () => (await page.textContent("#sensors-live"))?.replace(/\s+/g, " ").trim();
    const at = (t: number, v: number) =>
      page.evaluate(([t, v]) => {
        const w = window as unknown as { __fake: { read(id: string, m: string, v: number, at: number): void }; __setNow(t: number): void };
        w.__setNow(t!);
        w.__fake.read("h", "heartRate", v!, t!);
      }, [t, v]);
    assert.match((await live()) ?? "", /^142 bpm/);
    await at(10_300, 150);
    assert.match((await live()) ?? "", /^142 bpm/, "held within the second");
    await at(11_000, 151);
    assert.match((await live()) ?? "", /^151 bpm/, "steps after a second");
    await page.evaluate(() => (window as unknown as { __setNow(t: number): void }).__setNow(14_100));
    await page.waitForTimeout(600);
    assert.match((await live()) ?? "", /^– bpm/, "a dash, never the last number");
  } finally {
    await o.close();
  }
});

test("the panel's buttons call the source and nothing else; typed numbers give the gauge back", { timeout: 60_000 }, async () => {
  const o = await harness([1000, 720]);
  try {
    const { page } = o;
    await page.waitForSelector("#sensors");
    const calls = () => page.evaluate(() => (window as unknown as { __fake: { calls: string[] } }).__fake.calls);
    await page.evaluate(() => (window as unknown as { __fake: { set(p: unknown): void } }).__fake.set({ state: "idle" }));
    await page.click("#sensors-connect");
    assert.deepEqual(await calls(), ["connect"]);
    assert.equal(await page.isVisible("#sensors-chooser"), true, "the list opens in the drawer");
    await page.evaluate((s) => (window as unknown as { __fake: { set(p: unknown): void } }).__fake.set(s), { nearby: [{ id: "1", name: "Polar H10", services: ["heartRate"] }] });
    await page.click('[aria-label="Connect Polar H10"]');
    await page.click("#sensors-cancel");
    assert.deepEqual(await calls(), ["connect", "choose 1", "cancel"]);
    await drive(page, SHOTS[6]!);
    await page.click("#sensors-toggle");
    assert.equal(await page.locator("#sensors svg").count(), 1, "cadence only, with no numbers typed");
    await page.fill("#sensors-ftp", "250");
    await page.fill("#sensors-hrmax", "185");
    assert.equal(await page.locator("#sensors svg").count(), 3);
    assert.equal(await page.isVisible("#sensors-no-numbers"), false);
    await page.fill("#sensors-ftp", "49");
    assert.equal(await page.locator("#sensors svg").count(), 2, "an out-of-range number is no number");
    await drive(page, { ...SHOTS[5]!, numbers: true });
    await page.click('[aria-label="Reconnect Polar H10 A1B2C3"]');
    assert.equal((await calls()).at(-1), "reconnect h");
    await page.click('[aria-label="Disconnect Studio bike 7"]');
    assert.equal((await calls()).at(-1), "disconnect b");
    assert.deepEqual(o.errors, []);
  } finally {
    await o.close();
  }
});

