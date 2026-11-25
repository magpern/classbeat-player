// A treadmill's and a foot pod's readings on the rider page against their spec (docs/design/running-class.md,
// "The readings"; ADR 0015 sections 3 to 5; issue #771), on the fake site and live process with the scripted
// browser sensor API (sensor-fake.ts) replaying the recorded notifications of web/fixtures/sensors/running.json
// and a paused clock. Every state at the four class sizes, the sheet in portrait. Each stage checks the state's
// words, and every shot also checks the rules: the page says nothing but `hello` to the live process, makes no
// request but its join, asks the browser only for the allowlisted services and characteristics, writes nothing
// to a sensor and stores no reading (rule 13: no running reading leaves the phone).
// Shots: screenshots/rider/running-<state>-<size>.png (SPEC_ONLY, SPEC_JOBS as in rider-shots.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_DIR } from "../lib/browser.ts";
import { checkRiderShots } from "../lib/rider-shots.ts";
import { another, connect, press, rules as sharedRules, tick } from "../lib/rider-sensor-stages.ts";
import { FORM_SIZES, IN, NICK24, RUN, WORST, at, inClass, then, variant, words } from "../lib/rider-stages.ts";
import type { Stage, StateDef } from "../lib/rider-stages.ts";
import { FOOT_POD, TREADMILL, drop, hexBytes, notify } from "../lib/sensor-fake.ts";

const TREADMILL_DATA = 0x2acd;
const RSC = 0x2a53;

const recorded = JSON.parse(readFileSync(join(WEB_DIR, "fixtures", "sensors", "running.json"), "utf8")) as { treadmill: { hex: string }[]; rsc: { hex: string }[] };
/** The third Treadmill Data notification: 11.0 km/h, 3.0 % (the fixture file's own values). */
const TM = hexBytes(recorded.treadmill[2].hex);
/** The second RSC notification: 10.8 km/h, 170 steps a minute. */
const POD = hexBytes(recorded.rsc[1].hex);

const u16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
/** Treadmill Data with the inclination present: speed in 0.01 km/h, inclination in 0.1 %, ramp angle 0. */
const treadmillBytes = (kmh: number, pct: number): number[] => [0x08, 0x00, ...u16(Math.round(kmh * 100)), ...u16(Math.round(pct * 10)), 0, 0];
/** Running Speed and Cadence: speed in 1/256 m/s, cadence a whole number. */
const rscBytes = (kmh: number, spm: number): number[] => [0x00, ...u16(Math.round((kmh / 3.6) * 256)), spm];

const treadmill = (bytes = TM): Stage => async (f) => notify(f.page, TREADMILL.id, TREADMILL_DATA, bytes);
const pod = (bytes = POD): Stage => async (f) => notify(f.page, FOOT_POD.id, RSC, bytes);

/** A running zone has heart rate and RPE targets and no %FTP (running-class.md mock-ups). */
const effort = { ftpPct: null, hrmaxPct: [85, 92], rpe: [7, 8] };
const runZone = (z: object): object => ({ ...z, effort });
/** A running class on the rider page: the interval has no position (rider.md, "A running class"), so the clock's right-hand slot is empty. */
const RUN_CLASS = variant(RUN, { now: { ...(RUN.now as object), zone: runZone((RUN.now as { zone: object }).zone), position: null } });
const WORST_CLASS = variant(WORST, {
  now: { ...(WORST.now as object), zone: runZone((WORST.now as { zone: object }).zone), position: null, test: null },
  next: (WORST.next as { zone: object }[]).map((n) => ({ ...n, zone: runZone(n.zone), position: null })),
});

/** Every reading row's number, in order. */
const numbers = (expected: readonly string[]): Stage => async (f) => {
  const got = await f.page.$$eval(".effort.sens .rd.line .n", (els) => els.map((e) => e.textContent));
  assert.deepEqual(got, expected);
};
/** No reading row has a number: each is a grey dash with its unit kept (never the last number). */
const dashes = (units: readonly string[]): Stage => async (f) => {
  const rows = await f.page.$$eval(".effort.sens .rd.line", (els) => els.map((e) => [e.querySelector(".n")?.textContent, e.querySelector(".u")?.textContent, e.classList.contains("none")]));
  assert.deepEqual(rows, units.map((u) => ["–", u, true]));
};
/** RC3: the clock's right-hand slot is empty, and nothing says "Target" or an incline target (G1). */
const emptySlot: Stage = async (f) => {
  assert.equal(await f.page.locator(".clock .song").count(), 0, "the clock's right-hand slot is not empty");
  const body = await f.page.locator("body").innerText();
  assert.doesNotMatch(body, /Target|Incline (raised|flat)/);
};
/** RC8 and RC9: a reading is numbers only (no gauge, no meter) and white or grey, whatever its value. */
const plain: Stage = async (f) => {
  const r = await f.page.evaluate(() => {
    const colour = (v: string): string => {
      const probe = document.createElement("span");
      probe.style.color = `var(${v})`;
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    const allowed = [colour("--light-1"), colour("--light-2")];
    const rows = [...document.querySelectorAll(".effort.sens .rd.line")];
    return {
      rows: rows.length,
      gauges: rows.filter((e) => e.closest(".m")?.querySelector(".gauge, [role=meter]")).length,
      off: rows.flatMap((e) => [...e.children]).filter((c) => !allowed.includes(getComputedStyle(c).color)).map((c) => `${c.textContent} ${getComputedStyle(c).color}`),
    };
  });
  assert.ok(r.rows > 0, "no reading rows");
  assert.equal(r.gauges, 0, "a reading has a gauge");
  assert.deepEqual(r.off, [], "a reading is not white or grey");
};

/** Numbers no other part of the page shows, as shown, so a stored copy would be seen. */
const rules: Stage = sharedRules(["11.0", "3.0", "170", "10.8", "39.9", "14.8", "249"]);
const state = (open: StateDef["open"], ...stages: Stage[]): StateDef => ({ open, stage: then(...stages, rules) });
const sheet = (open: StateDef["open"], ...stages: Stage[]): StateDef => ({ ...state(open, ...stages), form: true });

const UNITS = ["km/h", "%", "steps/min"];

const STATES: Readonly<Record<string, StateDef>> = {
  // No sensor: the class view with the key "Connect a sensor"; no reading rows, no incline target.
  "running-idle": state(IN, inClass(RUN_CLASS), emptySlot, words(["Connect a sensor", "My numbers"], ["Speed", "Incline", "steps/min"])),
  // A treadmill (speed, incline) and a foot pod (cadence), all under 3 s old. Speed comes from the first connected.
  "running-readings": state(IN, inClass(RUN_CLASS), connect(TREADMILL), another(FOOT_POD), treadmill(), pod(), tick(), (f) => at(f, ".sens .rd.line"), numbers(["11.0", "3.0", "170"]), plain, emptySlot, words(["Speed", "km/h", "Incline", "%", "Cadence", "steps/min", "Sensors"], ["Connect a sensor", "rpm"])),
  // A treadmill alone: no Cadence row.
  "running-treadmill-only": state(IN, inClass(RUN_CLASS), connect(TREADMILL), treadmill(), tick(), numbers(["11.0", "3.0"]), plain, words(["Speed", "Incline"], ["Cadence", "steps/min"])),
  // A foot pod alone: its speed and cadence; no Incline row.
  "running-foot-pod-only": state(IN, inClass(RUN_CLASS), connect(FOOT_POD), pod(), tick(), numbers(["10.8", "170"]), plain, words(["Speed", "Cadence"], ["Incline"])),
  // Connected for more than 3 s with nothing heard: a dash for each, its unit kept.
  "running-missing": state(IN, inClass(RUN_CLASS), connect(TREADMILL), another(FOOT_POD), tick(3500), dashes(UNITS), words(["Speed", "Incline", "Cadence"])),
  // A reading older than 3 s (FRESH_MS) is missing, never the last number.
  "running-stale": state(IN, inClass(RUN_CLASS), connect(TREADMILL), another(FOOT_POD), treadmill(), pod(), tick(), numbers(["11.0", "3.0", "170"]), tick(3500), dashes(UNITS), words([], ["11.0"])),
  // A lost sensor: the plate and its words, the rows show dashes. Portrait only: in landscape the effort rows, the
  // two readings and the plate need more height than the screen has (reported in the pull request).
  "running-lost": { sizes: FORM_SIZES, ...state(IN, inClass(RUN_CLASS), connect(TREADMILL), treadmill(), tick(), async (f) => drop(f.page, TREADMILL.id), tick(), (f) => at(f, "[data-action=reconnect_sensor]"), dashes(["km/h", "%"]), words(["Sensor lost", `${TREADMILL.name}. Wake it, then press Reconnect.`, "Reconnect"])) },
  // The widest numbers beside the longest names, at all four sizes.
  "running-worst": state(IN, inClass(WORST_CLASS, true, NICK24), connect(TREADMILL), another(FOOT_POD), treadmill(treadmillBytes(39.9, 14.8)), pod(rscBytes(10.8, 249)), tick(), numbers(["39.9", "14.8", "249"]), plain, words(["39.9", "14.8", "249"])),
  // The sheet: each device with its state in words.
  "running-sheet": sheet(IN, inClass(RUN_CLASS), connect(TREADMILL), another(FOOT_POD), press("sensors"), words(["Sensors", TREADMILL.name, "Speed and incline, connected", FOOT_POD.name, "Speed and cadence, connected", "Disconnect"])),
};

checkRiderShots("a treadmill's and a foot pod's readings on the rider page against their spec", STATES);
