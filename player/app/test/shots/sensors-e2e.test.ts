// The instructor's sensor panel driven end to end (#750; docs/design/sensors.md, part 2) the way the
// instructor does it: press Connect a sensor, pick a device, see its reading, press Disconnect. The
// panel is the real renderer code on the FakeSensorSource (the harness), in headless Chrome, with
// the readings put in by the test. No Electron, no network, no Bluetooth. Needs `npm run build`.
// Rule 2: the source is only ever asked to connect, choose, cancel, disconnect or reconnect, and the
// page names no way to set resistance, speed, incline or a brake.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import type { Browser } from "playwright-core";
import { APP_DIR, launchChrome } from "./page.ts";

const T = 10_000;
const CONTROL_WORDS = /resistance|incline|brake|set.?target|control.?point|writeValue|requestControl/i;
// Every call the page may make on its source: a person's tap (connect, choose, cancel, disconnect, reconnect).
const ALLOWED_CALLS = /^(connect|choose \S+|cancel|disconnect \S+|reconnect \S+)$/;

let browser: Browser;
let dir: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "sensors-e2e-"));
  await build({ entryPoints: [join(APP_DIR, "test", "shots", "sensors-harness.ts")], outfile: join(dir, "sensors-harness.js"), bundle: true, platform: "browser", format: "iife", target: "chrome130", logLevel: "warning" });
  const html = readFileSync(join(APP_DIR, "src", "renderer", "presenter.html"), "utf8").replace("presenter.js", "sensors-harness.js");
  copyFileSync(join(APP_DIR, "dist", "presenter.css"), join(dir, "presenter.css"));
  writeFileSync(join(dir, "sensors.html"), html);
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

type Fake = { calls: string[]; add(id: string, name: string, m: string[]): void; read(id: string, m: string, v: number, at: number): void; set(p: unknown): void };

test("connect, a reading shown, disconnect: only taps reach the source, nothing leaves the file system", { timeout: 60_000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 720 }, reducedMotion: "reduce" });
  await context.addInitScript("globalThis.__name = (f) => f;");
  // Every Content-Security-Policy violation the page reports (a blocked script, style, image or connection).
  await context.addInitScript("globalThis.__csp = []; document.addEventListener('securitypolicyviolation', (e) => globalThis.__csp.push(e.violatedDirective + ' ' + e.blockedURI));");
  const page = await context.newPage();
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => void (r.url().startsWith("file:") || external.push(r.url())));
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`file://${join(dir, "sensors.html")}`);
    await page.waitForSelector("#sensors");
    // Idle: nothing connected, one button.
    assert.equal(await page.getAttribute("#sensors", "data-state"), "idle");
    assert.match((await page.textContent("#sensors")) ?? "", /Nothing connected/);

    // Connect a sensor: the app's own list of nearby devices opens.
    await page.click("#sensors-connect");
    await page.evaluate(() => (window as unknown as { __fake: Fake }).__fake.set({ nearby: [{ id: "h", name: "Polar H10 A1B2C3", services: ["heartRate"] }] }));
    await page.waitForSelector("#sensors-nearby button");
    assert.match((await page.textContent("#sensors-chooser")) ?? "", /Polar H10 A1B2C3/);

    // The instructor picks it; the source connects it and a reading arrives.
    await page.click("#sensors-nearby button");
    await page.evaluate((now) => {
      const w = (window as unknown as { __fake: Fake }).__fake;
      w.set({ state: "connected", nearby: [] });
      w.add("h", "Polar H10 A1B2C3", ["heartRate"]);
      w.read("h", "heartRate", 142, now);
    }, T);
    await page.evaluate((t) => (window as unknown as { __setNow(t: number): void }).__setNow(t), T);
    await page.waitForFunction(() => document.getElementById("sensors-live")?.textContent?.includes("142"));
    assert.match((await page.textContent("#sensors")) ?? "", /Connected/);
    assert.match((await page.textContent("#sensors-live")) ?? "", /142 bpm/);

    // Open the drawer: the device and its reading, with its Disconnect.
    await page.click("#sensors-toggle");
    assert.match((await page.textContent("#sensors-devices")) ?? "", /Polar H10 A1B2C3/);
    assert.match((await page.textContent("#sensors-measures")) ?? "", /142/);

    // Disconnect: the device goes, the panel is idle again.
    await page.click("#sensors-devices button");
    await page.waitForFunction(() => document.getElementById("sensors")?.dataset.state === "idle");
    assert.match((await page.textContent("#sensors")) ?? "", /Nothing connected/);
    assert.equal(await page.locator("#sensors-devices li").count(), 0);

    // Rule 2: every call on the source was a tap, in order, and none sets anything on a bike.
    const calls = await page.evaluate(() => (window as unknown as { __fake: Fake }).__fake.calls);
    assert.deepEqual(calls, ["connect", "choose h", "disconnect h"]);
    assert.ok(calls.every((c) => ALLOWED_CALLS.test(c)), `only taps reach the source: ${calls}`);
    const src = await page.evaluate(() => Object.getOwnPropertyNames(Object.getPrototypeOf((window as unknown as { __fake: object }).__fake)));
    assert.deepEqual(src.filter((n) => CONTROL_WORDS.test(n)), [], "the source has no control method");
    assert.doesNotMatch((await page.content()).replace(/<script[\s\S]*?<\/script>/g, ""), CONTROL_WORDS, "the page names no control");

    // No network: every request was for the file system, and the page raised nothing.
    assert.deepEqual(external, [], "no request left the file system");
    assert.deepEqual(errors, [], "no page errors");
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp), [], "no CSP violation");
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __unexpected: string[] }).__unexpected), [], "the panel used only the SensorSource methods");
  } finally {
    await context.close();
  }
});
