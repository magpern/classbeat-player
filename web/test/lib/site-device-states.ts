// The states of the devices and pairing pages (docs/design/site.md, "Devices and pairing") and how
// to reach each on the fake backend. Spread into STATES (site-states.ts), so the S1 to S12 checks
// and "nothing secret leaves the page" run on every one.
import type { Page } from "playwright-core";
import type { Script } from "./site-fake.ts";
import type { State } from "./site-states.ts";

/** A code as the player shows it, and the same eight letters as the page sends them. */
export const PAIR_CODE = "BCDF-GHJK";
export const PAIR_LETTERS = "BCDFGHJK";

export const DEVICES = [
  { id: "6a1f3c2e-4b5d-4e6f-8a7b-9c0d1e2f3a4b", name: "Studio PC", platform: "Windows", version: "0.4.0", paired_at: "2026-11-03T09:12:00.123456+00:00", last_used_at: "2026-11-13T09:30:00+00:00" },
  { id: "7b2e4d3f-5c6e-4f70-9b8c-0d1e2f3a4b5c", name: "Laptop", platform: "macOS", version: "0.4.0", paired_at: "2026-10-21T15:00:00+00:00", last_used_at: "2026-11-09T18:45:00+00:00" },
  { id: "8c3f5e40-6d7f-4081-ac9d-1e2f3a4b5c6d", name: "Spare computer", platform: "Linux", version: "0.3.2", paired_at: "2026-09-12T11:00:00+00:00", last_used_at: null },
] as const;

const signedIn: Script = { "GET sessions": { status: 200, body: { sessions: [] } } };
export const LISTED: Script = { "GET devices": { status: 200, body: { devices: DEVICES } } };
export const FOUND = { status: 200, body: { platform: "macOS", version: "0.4.0" } } as const;

const press = (name: string) => async (page: Page): Promise<void> => {
  await page.getByRole("button", { name, exact: true }).click();
};
const typeCode = (typed: string) => async (page: Page): Promise<void> => {
  await page.fill("input[name=code]", typed);
  await page.click("button[type=submit]");
};
const then = (...steps: ((page: Page) => Promise<void>)[]) => async (page: Page): Promise<void> => {
  for (const s of steps) await s(page);
};
const revokeFirst = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Revoke", exact: true }).first().click();
};
const found = (decide?: Script[string]): Script => ({ ...signedIn, "POST pairing/find": FOUND, ...(decide ? { "POST pairing/decide": decide } : {}) });
const reachFound = then(typeCode(PAIR_CODE), async (page) => void (await page.waitForSelector(".dev-codebox")));

export const DEVICE_STATES: readonly State[] = [
  { name: "devices", path: "/devices", script: LISTED, ready: ".dev-item", main: true, clock: "day" },
  { name: "devices-empty", path: "/devices", script: { "GET devices": { status: 200, body: { devices: [] } } }, ready: "h2", clock: "day" },
  { name: "devices-revoke", path: "/devices", script: LISTED, steps: revokeFirst, ready: ".dev-panel [data-keep]:focus", clock: "day" },
  { name: "devices-revoked", path: "/devices", script: { ...LISTED, [`DELETE devices/${DEVICES[0].id}`]: { status: 204 } }, steps: then(revokeFirst, press("Revoke device")), ready: ".note", clock: "day" },
  { name: "devices-revoke-offline", path: "/devices", script: { ...LISTED, [`DELETE devices/${DEVICES[0].id}`]: { status: 0, fail: true } }, steps: then(revokeFirst, press("Revoke device")), ready: ".plate", clock: "day" },
  { name: "devices-server", path: "/devices", script: { "GET devices": { status: 500, body: { error: "internal" } } }, ready: ".plate" },
  { name: "pair", path: "/pair", script: signedIn, ready: "input[name=code]", main: true },
  { name: "pair-invalid-code", path: "/pair", script: signedIn, steps: typeCode("BCDF-GH"), ready: ".field.err" },
  { name: "pair-not-found", path: "/pair", script: { ...signedIn, "POST pairing/find": { status: 404, body: { error: "pairing_not_found" } } }, steps: typeCode("BCDF-GHJL"), ready: ".plate" },
  { name: "pair-offline", path: "/pair", script: { ...signedIn, "POST pairing/find": { status: 0, fail: true } }, steps: typeCode(PAIR_CODE), ready: ".plate" },
  { name: "pair-found", path: "/pair", script: found(), steps: reachFound, ready: "h1:focus", main: true },
  { name: "pair-approved", path: "/pair", script: found({ status: 200, body: { status: "approved" } }), steps: then(reachFound, press("Pair this device")), ready: ".note" },
  { name: "pair-denied", path: "/pair", script: found({ status: 200, body: { status: "denied" } }), steps: then(reachFound, press("Not this one")), ready: ".note" },
  { name: "pair-too-many-devices", path: "/pair", script: found({ status: 409, body: { error: "too_many_devices" } }), steps: then(reachFound, press("Pair this device")), ready: ".plate" },
  { name: "pair-invalid-name", path: "/pair", script: found({ status: 422, body: { error: "invalid_name" } }), steps: then(reachFound, press("Pair this device")), ready: ".field.err" },
  { name: "pair-decide-server", path: "/pair", script: found({ status: 503, body: { error: "unavailable" } }), steps: then(reachFound, press("Pair this device")), ready: ".plate" },
];
