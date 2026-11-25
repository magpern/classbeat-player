// The stages and rules the rider page's sensor checks share (rider-sensor-checks.test.ts for the bike's
// and the strap's readings, rider-running-checks.test.ts for a treadmill's and a foot pod's): press a
// key, connect a fake device, and the rules every shot keeps (sensors.md, "Never"; ADR 0012; ADR 0015;
// rules 2, 4 and 6).
import assert from "node:assert/strict";
import { at, then } from "./rider-stages.ts";
import type { Stage } from "./rider-stages.ts";
import { pick } from "./sensor-fake.ts";
import type { FakeDevice } from "./sensor-fake.ts";

/** ADR 0012 section 1 and ADR 0015 section 3: the services and measurement characteristics the page may ask for. */
export const SERVICES = [0x180d, 0x1816, 0x1818, 0x1826, 0x1814];
export const CHARACTERISTICS = [0x2a37, 0x2a5b, 0x2a63, 0x2ad2, 0x2acd, 0x2a53];

export const tick = (ms = 300): Stage => async (f) => void (await f.page.clock.runFor(ms));
export const press = (action: string): Stage => async (f) => {
  await f.page.click(`[data-action=${action}]`);
  await f.page.clock.runFor(300);
};
/** Presses the second key of the foot row and picks `d` in the browser's list. */
export const connect = (d: FakeDevice, action = "sensors"): Stage => then(press(action), async (f) => pick(f.page, d), tick(), (f) => at(f, `[data-action=sensors]:not([disabled])`));
/** A second sensor: through the sheet's Connect another sensor. */
export const another = (d: FakeDevice): Stage => then(press("sensors"), connect(d, "sensors_add"));

/** The least space between a sensor plate's bottom and the keys' top, in CSS pixels, where both show side by side (landscape). */
export const PLATE_KEY_GAP = 4;

/**
 * In landscape the plate sits above the keys with at least PLATE_KEY_GAP px between them: a plate running under the
 * keys clips its last line, and no other check compares the two (design review of #781). No plate: nothing to check.
 */
export const plateAboveKeys: Stage = async (f) => {
  const r = await f.page.evaluate(() => {
    const plate = document.querySelector(".splate")?.getBoundingClientRect();
    const keys = document.querySelector(".keys")?.getBoundingClientRect();
    return { landscape: innerWidth > innerHeight, plate: plate ? plate.bottom : null, keys: keys ? keys.top : null };
  });
  if (!r.landscape || r.plate === null || r.keys === null) return;
  assert.ok(r.keys - r.plate >= PLATE_KEY_GAP, `the plate's bottom (${r.plate.toFixed(1)}) is ${(r.keys - r.plate).toFixed(1)} px above the keys' top (${r.keys.toFixed(1)}), under ${PLATE_KEY_GAP} px`);
};

/**
 * The rules every shot keeps:the page says nothing but `hello` to the live process, makes no request
 * but its one join, asks the browser only for the allowlisted services and characteristics, writes
 * nothing to a sensor, and stores none of `readings` (numbers no other part of the page shows).
 */
export const rules = (readings: readonly (number | string)[]): Stage => async (f) => {
  await plateAboveKeys(f);
  const types = f.live.sent.map((m) => (JSON.parse(m) as { type?: string }).type);
  assert.ok(types.every((t) => t === "hello"), `the page sent ${types.join(", ")}`);
  const traps = await f.traps();
  const requests = traps.filter((t) => t.kind === "fetch").map((t) => t.detail.split(" ").slice(0, 2).join(" "));
  assert.ok(requests.every((r) => r === "POST /api/live/join"), `the page made a request besides its join: ${requests.join(", ")}`);
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
  const kept = traps.filter((t) => t.kind === "storage" && readings.some((n) => t.detail.includes(String(n))));
  assert.deepEqual(kept, [], "a reading was stored");
};
