// The rider's sensor readings as the class view shows them (docs/design/sensors.md, part 1; issue
// #663): the model's rows, plates, lines and key, the once-a-second step, the gauge with no
// reading, the words it never says, and the wiring that keeps the browser's sensor code on the web
// page alone (the "#browser-sensors" name and the Android app's unavailable source).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { effortFor, HINT, NO_NUMBERS } from "../../src/rider/core/effort-calc.ts";
import type { Effort } from "../../src/rider/core/effort-calc.ts";
import { numbersHint, PLATES, sensorKey, sensorView, stepShown } from "../../src/rider/core/sensor-view.ts";
import type { Shown } from "../../src/rider/core/sensor-view.ts";
import { SHEET_NOTE, UNSUPPORTED } from "../../src/rider/render/sensors.ts";
import { gauge } from "../../src/sensors/core/gauge-calc.ts";
import { deviceWords, NO_SENSORS, step } from "../../src/sensors/core/readings.ts";
import type { SensorEvent, Sensors } from "../../src/sensors/core/readings.ts";
import { isIphone } from "../../src/sensors/core/platform.ts";
import { unavailableSource } from "../../src/sensors/source.ts";
import { WEB_DIR } from "../lib/browser.ts";

const ZONE = { ftpPct: [76, 90] as const, hrmaxPct: [80, 88] as const, rpe: [5, 6] as const };
const MINE = { ftp: 250, hrmax: 190 };
const run = (...es: SensorEvent[]): Sensors => es.reduce(step, NO_SENSORS);
const hr = { type: "connected", id: "a", name: "Strap", gives: ["hr"], at: 0 } as const;
const bike = { type: "connected", id: "b", name: "Bike", gives: ["power", "cadence"], at: 0 } as const;
const view = (e: Effort | null, s: Sensors, shown: Shown = {}, now = 1000, ok = true) => sensorView(e, s, shown, now, ok, "Try again.");

describe("the second key of the foot row", () => {
  const cases: [string, Sensors, boolean, string, string, boolean][] = [
    ["idle", NO_SENSORS, true, "sensors", "Connect a sensor", false],
    ["unsupported", NO_SENSORS, false, "sensors", "Connect a sensor", false],
    ["choosing", run({ type: "choosing" }), true, "sensors", "Choosing…", true],
    ["connected", run(hr), true, "sensors", "Sensors", false],
    ["lost", run(hr, { type: "lost", id: "a" }), true, "reconnect_sensor", "Reconnect", false],
  ];
  for (const [n, s, ok, action, label, dis] of cases) it(n, () => assert.deepEqual(sensorKey(s, ok), { action, label, dis }));
});

describe("sensorView", () => {
  const e = effortFor(ZONE, MINE);
  it("no sensor: the effort as before", () => assert.equal(view(e, NO_SENSORS).block, null));
  it("unsupported: the effort as before", () => assert.equal(view(e, run(hr), {}, 1000, false).block, null));
  it("no effort: nothing", () => assert.equal(view(null, run(hr)).block, null));

  it("heart rate beside its plan, with a gauge; power has no reading; RPE last", () => {
    const b = view(e, run(hr), { hr: 160 })!.block!;
    assert.deepEqual(b.rows.map((r) => r.label), ["Power", "Heart rate", "RPE"]);
    assert.equal(b.rows[0]!.read, null);
    const r = b.rows[1]!.read!;
    assert.equal(r.value, 160);
    assert.deepEqual(r.gauge, gauge([152, 167], 160));
    assert.equal(r.aria, "Heart rate 160 bpm, plan 152 to 167");
    assert.equal(b.rows[2]!.read, null);
    assert.equal(b.plate, null);
    assert.equal(b.hint, null);
  });

  it("bike: power with a gauge and cadence alone (no plan)", () => {
    const b = view(e, run(bike), { power: 200, cadence: 90 })!.block!;
    assert.deepEqual(b.rows.map((r) => r.label), ["Power", "Heart rate", "Cadence", "RPE"]);
    assert.equal(b.rows[2]!.plan, null);
    assert.equal(b.rows[2]!.read!.gauge, "solo");
    assert.equal(b.rows[2]!.read!.aria, "Cadence 90 rpm");
  });

  it("a dash and no tick with no reading", () => {
    const r = view(e, run(hr), { hr: null })!.block!.rows[1]!.read!;
    assert.equal(r.value, null);
    assert.equal((r.gauge as { tick: number | null }).tick, null);
    assert.equal(r.aria, "Heart rate no reading, plan 152 to 167");
  });

  it("no numbers: a hidden gauge and the line naming the number", () => {
    const b = view(effortFor(ZONE, NO_NUMBERS), run(hr), { hr: 150 })!.block!;
    assert.equal(b.rows[1]!.read!.gauge, "none");
    assert.equal(b.hint, numbersHint(["hr"]));
    assert.equal(b.hint, "Add your max heart rate in My numbers to see the gauge.");
    assert.equal(numbersHint(["power", "hr"]), "Add your FTP and max heart rate in My numbers to see the gauge.");
  });

  it("the percent line stays when no sensor needs a number", () => {
    const b = view(effortFor(ZONE, { ftp: null, hrmax: 190 }), run(hr), { hr: 150 })!.block!;
    assert.equal(b.hint, HINT);
  });

  it("missing: connected past the hold with no value", () => {
    const b = view(e, run(hr), {}, 5000)!.block!;
    assert.equal(b.hint, "No heart rate from your strap.");
    assert.equal(view(e, run(hr), {}, 2000)!.block!.hint, null);
  });

  it("plates: choosing, lost (with the name), failed (with the detail)", () => {
    assert.deepEqual(view(e, run({ type: "choosing" }))!.block!.plate, { head: PLATES.choosing[0], detail: PLATES.choosing[1] });
    assert.deepEqual(view(e, run(hr, { type: "lost", id: "a" }))!.block!.plate, { head: "Sensor lost", detail: "Strap. Wake it, then press Reconnect." });
    assert.deepEqual(view(e, run({ type: "failed" }))!.block!.plate, { head: "Could not connect", detail: "Try again." });
    assert.equal(view(e, run({ type: "choosing" }, { type: "closed" }))!.block, null);
  });
});

describe("the once-a-second step", () => {
  it("first value at once", () => assert.deepEqual(stepShown(undefined, 120, 0), { value: 120, at: 0 }));
  it("holds a new number under a second", () => assert.deepEqual(stepShown({ value: 120, at: 0 }, 125, 999), { value: 120, at: 0 }));
  it("takes it after a second", () => assert.deepEqual(stepShown({ value: 120, at: 0 }, 125, 1000), { value: 125, at: 1000 }));
  it("a dash at once", () => assert.deepEqual(stepShown({ value: 120, at: 0 }, null, 10), { value: null, at: 10 }));
  it("a number after a dash at once", () => assert.deepEqual(stepShown({ value: null, at: 0 }, 130, 10), { value: 130, at: 10 }));
  it("the same value keeps its time", () => assert.deepEqual(stepShown({ value: 120, at: 0 }, 120, 5000), { value: 120, at: 0 }));
});

describe("the gauge", () => {
  it("no reading: no tick, band unchanged", () => {
    const g = gauge([200, 225], null);
    assert.equal(g.tick, null);
    assert.deepEqual({ ...g, tick: 0 }, { ...gauge([200, 225], 210), tick: 0 });
  });
  it("the tick is clamped to the track", () => {
    assert.equal(gauge([200, 225], 0).tick, 0);
    assert.equal(gauge([200, 225], 2000).tick, 100);
  });
});

describe("words", () => {
  const NEVER = /too high|too low|in range|target heart rate zone|adjust|push|ease off/i;
  const s = run(hr, bike);
  const all = [
    SHEET_NOTE,
    ...Object.values(UNSUPPORTED),
    ...Object.values(PLATES).flat(),
    numbersHint(["power", "hr"]),
    HINT,
    "No heart rate from your strap.",
    ...s.devices.map((d) => deviceWords(s, d)),
    ...[NO_SENSORS, s, run({ type: "choosing" }), run(hr, { type: "lost", id: "a" })].map((x) => sensorKey(x, true).label),
  ];
  for (const w of all) it(JSON.stringify(w), () => assert.doesNotMatch(w, NEVER));
  it("the sources' sheets and plates as the code holds them", () => {
    for (const f of ["src/rider/core/sensor-view.ts", "src/rider/render/sensors.ts", "src/sensors/core/readings.ts", "src/sensors/web-bluetooth.ts"]) {
      const strings = readFileSync(join(WEB_DIR, f), "utf8").match(/"[^"\n]*"|`[^`\n]*`/g) ?? [];
      for (const t of strings) assert.doesNotMatch(t, NEVER, `${f}: ${t}`);
    }
  });
});

describe("the iPhone sheet (owner, 2026-11-24)", () => {
  it("names the classbeat Player app and no other browser", () => {
    assert.match(UNSUPPORTED.iphone, /classbeat Player app/);
    assert.doesNotMatch(UNSUPPORTED.iphone, /Bluefy|browser/i);
  });
});

describe("platform", () => {
  it("iPhone", () => assert.equal(isIphone({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", maxTouchPoints: 5 }), true));
  it("Android", () => assert.equal(isIphone({ userAgent: "Mozilla/5.0 (Linux; Android 15)", maxTouchPoints: 5 }), false));
});

describe("the browser's sensor code reaches only the rider web page", () => {
  it("package.json names one internal import, #browser-sensors, for web-bluetooth.ts", () => {
    const pkg = JSON.parse(readFileSync(join(WEB_DIR, "package.json"), "utf8")) as { imports?: Record<string, string> };
    assert.deepEqual(pkg.imports, { "#browser-sensors": "./src/sensors/web-bluetooth.ts" });
  });
  // Any string naming the module counts, so a dynamic import, a re-export, a require or a relative
  // path to the file is caught as well as a static import.
  const NAMES_IT = /["'`](#browser-sensors|[^"'`\n]*\/web-bluetooth(\.ts|\.js)?)["'`]/;
  it("the pin catches every way to reach the module", () => {
    for (const src of ['import { b } from "#browser-sensors";', 'await import("#browser-sensors")', "import('#browser-sensors')", 'export * from "#browser-sensors";', 'require("#browser-sensors")', 'import("../sensors/web-bluetooth.ts")', 'import "./web-bluetooth";']) {
      assert.match(src, NAMES_IT, src);
    }
    assert.doesNotMatch('import { unavailableSource } from "../sensors/source.ts";', NAMES_IT);
  });
  it("only src/rider/main.ts takes it", async () => {
    const { readdirSync } = await import("node:fs");
    const users: string[] = [];
    for (const f of readdirSync(join(WEB_DIR, "src"), { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|js|mjs|cjs)$/.test(f) || f.replaceAll("\\", "/") === "sensors/web-bluetooth.ts") continue;
      if (NAMES_IT.test(readFileSync(join(WEB_DIR, "src", f), "utf8"))) users.push(f.replaceAll("\\", "/"));
    }
    assert.deepEqual(users, ["rider/main.ts"]);
  });
  it("the Android rider page passes the unavailable source", () => {
    const src = readFileSync(join(WEB_DIR, "..", "player", "mobile", "src", "rider.ts"), "utf8");
    assert.match(src, /new RiderModeApp\(riderMode\(\), document\.body, unavailableSource\(\)\);/);
    assert.doesNotMatch(src, /browser-sensors|browserSensors/);
    const u = unavailableSource();
    assert.equal(u.supported, false);
  });
});
