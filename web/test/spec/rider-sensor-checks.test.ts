// The rider's own sensors on the rider page against their spec (docs/design/sensors.md, S1 to S9;
// issue #663), on the fake site and live process with a scripted browser sensor API (sensor-fake.ts)
// and a paused clock: every state of the spec, the class states at the four sizes, the sheets in
// portrait. Each stage checks the state's words, and every shot also checks the rules: the page says
// nothing but `hello` to the live process, asks the browser only for the allowlisted services and
// characteristics (ADR 0012), writes nothing to a sensor and stores no reading.
// Shots: screenshots/rider/sensors-<state>-<size>.png (SPEC_ONLY, SPEC_JOBS as in rider-shots.ts).
import assert from "node:assert/strict";
import { checkRiderShots } from "../lib/rider-shots.ts";
import { IN, NICK24, RUN, WORST, at, inClass, then, words } from "../lib/rider-stages.ts";
import type { Stage, StateDef } from "../lib/rider-stages.ts";
import { BIKE, IPHONE_UA, STRAP, bikeBytes, cancel, drop, hrBytes, notify, pick, refuse } from "../lib/sensor-fake.ts";
import type { FakeDevice } from "../lib/sensor-fake.ts";

/** ADR 0012: the services and measurement characteristics the page may ask for. */
const SERVICES = [0x180d, 0x1816, 0x1818, 0x1826];
const CHARACTERISTICS = [0x2a37, 0x2a5b, 0x2a63, 0x2ad2];
const HR = 0x2a37;
const BIKE_DATA = 0x2ad2;
// Readings no other part of the page shows, so a stored copy would be seen.
const BPM = 163;
const WATTS = 227;
const RPM = 91;

const WIDE: FakeDevice = { id: "wide", name: "W".repeat(32), services: [0x1826] };
const GARMIN: FakeDevice = { id: "garmin", name: "Garmin HRM-Pro 0042", services: [0x180d] };

const tick = (ms = 300): Stage => async (f) => void (await f.page.clock.runFor(ms));
const press = (action: string): Stage => async (f) => {
  await f.page.click(`[data-action=${action}]`);
  await f.page.clock.runFor(300);
};
/** Presses the second key of the foot row and picks `d` in the browser's list. */
const connect = (d: FakeDevice, action = "sensors"): Stage => then(press(action), async (f) => pick(f.page, d), tick(), (f) => at(f, `[data-action=sensors]:not([disabled])`));
/** A second sensor: through the sheet's Connect another sensor. */
const another = (d: FakeDevice): Stage => then(press("sensors"), connect(d, "sensors_add"));
const heart = (d: FakeDevice, bpm = BPM): Stage => async (f) => notify(f.page, d.id, HR, hrBytes(bpm));
const ride = (d: FakeDevice, watts = WATTS, rpm = RPM): Stage => async (f) => notify(f.page, d.id, BIKE_DATA, bikeBytes(watts, rpm));

/** The rules every shot keeps (sensors.md, "Never"; ADR 0012; rules 4 and 6). */
const rules: Stage = async (f) => {
  const types = f.live.sent.map((m) => (JSON.parse(m) as { type?: string }).type);
  assert.ok(types.every((t) => t === "hello"), `the page sent ${types.join(", ")}`);
  const traps = await f.traps();
  for (const { detail } of traps.filter((t) => t.kind === "sensor")) {
    assert.doesNotMatch(detail, /^write/, "a write to a sensor");
    const [what, rest] = [detail.split(" ")[0], detail.slice(detail.indexOf(" ") + 1)];
    if (what === "request") {
      const o = JSON.parse(rest) as { filters: { services: number[] }[]; optionalServices: number[] };
      for (const s of [...o.filters.flatMap((x) => x.services), ...o.optionalServices]) assert.ok(SERVICES.includes(s), `asked for service ${s.toString(16)}`);
    }
    if (what === "service") assert.ok(SERVICES.includes(Number.parseInt(rest, 16)), detail);
    if (what === "characteristic" || what === "notify") assert.ok(CHARACTERISTICS.includes(Number.parseInt(rest, 16)), detail);
  }
  const kept = traps.filter((t) => t.kind === "storage" && [BPM, WATTS, RPM].some((n) => t.detail.includes(String(n))));
  assert.deepEqual(kept, [], "a reading was stored");
};
const state = (open: StateDef["open"], ...stages: Stage[]): StateDef => ({ open, stage: then(...stages, rules) });
const sheet = (open: StateDef["open"], ...stages: Stage[]): StateDef => ({ ...state(open, ...stages), form: true });
/**
 * Sets the class up with the screen turned, then turns it back to the shot's size: the next rows give
 * way again for the height the readings now have (sensors.md, "Fitting"). They give way exactly as far
 * as they must: one step less spills over, and the step they are at does not (or it is the last).
 */
const turned = (...stages: Stage[]): Stage => async (f) => {
  const size = f.page.viewportSize()!;
  await f.page.setViewportSize({ width: size.height, height: size.width });
  await then(...stages)(f);
  // The browser sends resize at its next frame; a listener added after the page's own one says it has.
  await f.page.evaluate(() => addEventListener("resize", () => document.documentElement.setAttribute("data-turned", ""), { once: true }));
  await f.page.setViewportSize(size);
  await f.page.waitForFunction(() => document.documentElement.hasAttribute("data-turned"), null, { polling: 50, timeout: 10_000 });
  await f.page.evaluate(() => document.documentElement.removeAttribute("data-turned"));
  const r = await f.page.evaluate(() => {
    const [root, effort, coming] = ["main.run", ".effort", ".coming"].map((s) => document.querySelector<HTMLElement>(s)!);
    const steps = [[], ["fit-L2", "fit-P2"], ["fit-L2", "fit-P2", "fit-L1", "fit-P1"]];
    const over = (): boolean => root.scrollHeight > root.clientHeight || effort.scrollHeight > effort.clientHeight;
    const set = (k: number): void => {
      coming.classList.remove(...steps[2]);
      coming.classList.add(...steps[k]);
    };
    const now = [...coming.classList].filter((c) => c.startsWith("fit-")).length / 2;
    const fits = now === 2 || !over();
    let less = true;
    if (now > 0) {
      set(now - 1);
      less = over();
      set(now);
    }
    return { now, fits, less };
  });
  assert.ok(r.fits, `the readings spill over at step ${r.now} after the turn`);
  assert.ok(r.less, `the next rows gave way to step ${r.now} with room for one step less after the turn`);
};

const SHEET_WORDS = ["Sensors", "Readings stay on this phone. Nothing is sent, saved or compared.", "Connect another sensor", "Done"];

const STATES: Readonly<Record<string, StateDef>> = {
  // The class view (all sizes).
  "sensors-idle": state(IN, inClass(RUN), words(["Connect a sensor", "220–235", "157–170", "My numbers"], ["Choosing…", "Sensors"])),
  "sensors-choosing": state(IN, inClass(RUN), press("sensors"), words(["Choose your sensor", "Pick it in your browser’s list.", "Choosing…"])),
  "sensors-heart": state(IN, inClass(RUN), connect(STRAP), heart(STRAP), tick(), (f) => at(f, ".sens .rd"), words([String(BPM), "157–170", "bpm", "220–235", "Sensors"], ["Connect a sensor", "rpm"])),
  "sensors-both": state(IN, inClass(RUN), connect(STRAP), another(BIKE), heart(STRAP), ride(BIKE), tick(), words([String(BPM), String(WATTS), String(RPM), "Cadence", "rpm", "220–235", "157–170"])),
  "sensors-no-numbers": state(IN, inClass(RUN, false), connect(STRAP), heart(STRAP), tick(), words([String(BPM), "Add your max heart rate in My numbers to see the gauge."])),
  "sensors-missing": state(IN, inClass(RUN), connect(STRAP), tick(3500), words(["No heart rate from your strap."], [String(BPM)])),
  "sensors-lost": state(IN, inClass(RUN), connect(STRAP), heart(STRAP), tick(), async (f) => drop(f.page, STRAP.id), tick(), (f) => at(f, "[data-action=reconnect_sensor]"), words(["Sensor lost", `${STRAP.name}. Wake it, then press Reconnect.`, "Reconnect"])),
  "sensors-failed": state(IN, inClass(RUN), press("sensors"), async (f) => refuse(f.page), tick(), words(["Could not connect", "Check that Bluetooth is on and the sensor is awake.", "Connect a sensor"])),
  "sensors-closed": state(IN, inClass(RUN), press("sensors"), async (f) => cancel(f.page), tick(), words(["Connect a sensor"], ["Choose your sensor", "Could not connect"])),
  "sensors-worst": state(IN, inClass(WORST, true, NICK24), connect(GARMIN), another(WIDE), heart(GARMIN, 230), ride(WIDE, 1999, 199), tick(), words(["230", "1999", "199", "Standing"])),
  // The same, set up with the screen turned and then turned back.
  "sensors-worst-turned": state(IN, turned(inClass(WORST, true, NICK24), connect(GARMIN), another(WIDE), heart(GARMIN, 230), ride(WIDE, 1999, 199), tick()), words(["230", "1999", "199", "Standing"])),
  // The sheets (portrait).
  "sensors-sheet": sheet(IN, inClass(RUN), connect(STRAP), another(BIKE), press("sensors"), words([...SHEET_WORDS, STRAP.name, "Heart rate, connected", BIKE.name, "Power and cadence, connected", "Disconnect"])),
  "sensors-sheet-lost": sheet(IN, inClass(RUN), connect(STRAP), another(BIKE), press("sensors"), async (f) => drop(f.page, BIKE.id), tick(), (f) => at(f, "[data-action=reconnect_sensor]"), words([...SHEET_WORDS, "Power and cadence, lost", "Reconnect", "Heart rate, connected"])),
  "sensors-unsupported": sheet({ ...IN, sensors: "none" }, inClass(RUN), words(["Connect a sensor"]), press("sensors"), words(["This browser cannot connect to a sensor", "Open this page in Chrome on an Android phone.", "Done"], ["Bluefy"])),
  "sensors-unsupported-iphone": sheet({ ...IN, sensors: "none", userAgent: IPHONE_UA }, inClass(RUN), press("sensors"), words(["This browser cannot connect to a sensor", "On an iPhone this page gives the targets and the timing.", "Sensors need the installed classbeat Player app (rider mode).", "Done"], ["Chrome", "Bluefy"])),
  "sensors-worst-sheet": sheet(IN, inClass(WORST, true, NICK24), connect(GARMIN), another(WIDE), press("sensors"), async (f) => drop(f.page, WIDE.id), tick(), words([...SHEET_WORDS, WIDE.name, GARMIN.name, "Power and cadence, lost", "Heart rate, connected"])),
};

checkRiderShots("the rider's own sensors against their spec", STATES);
