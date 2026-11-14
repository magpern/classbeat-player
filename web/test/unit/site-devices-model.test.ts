// The devices page's pure rules (src/site/core/devices-model.ts): what `GET devices` holds, the
// words of a row, and what a revoke's answer means.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countWords, dayWords, devicesOf, lastUsedWords, pairedWords, platformWords, revokeOutcome } from "../../src/site/core/devices-model.ts";

const ROW = { id: "6a1f3c2e-4b5d-4e6f-8a7b-9c0d1e2f3a4b", name: "Studio PC", platform: "Windows", version: "0.4.0", paired_at: "2026-11-03T09:12:00.123456+00:00", last_used_at: null };
const TODAY = { year: 2026, month: 11, day: 13 };

describe("GET devices", () => {
  it("reads the backend's rows in its order", () => {
    const second = { ...ROW, id: "7b2e4d3f-5c6e-4f70-9b8c-0d1e2f3a4b5c", name: "Laptop", last_used_at: "2026-11-09T18:45:00+00:00" };
    assert.deepEqual(devicesOf({ devices: [ROW, second] })?.map((d) => [d.name, d.lastUsedAt]), [["Studio PC", null], ["Laptop", "2026-11-09T18:45:00+00:00"]]);
    assert.deepEqual(devicesOf({ devices: [] }), []);
  });

  it("refuses a body it does not understand", () => {
    for (const body of [null, {}, { devices: {} }, { devices: [null] }]) assert.equal(devicesOf(body), null, JSON.stringify(body));
    for (const id of ["../sessions", "6A1F3C2E-4B5D-4E6F-8A7B-9C0D1E2F3A4B", "x", "", 1]) assert.equal(devicesOf({ devices: [{ ...ROW, id }] }), null, String(id));
    for (const bad of [{ name: 1 }, { platform: null }, { version: undefined }, { paired_at: "yesterday" }, { last_used_at: "soon" }, { last_used_at: 0 }]) {
      assert.equal(devicesOf({ devices: [{ ...ROW, ...bad }] }), null, JSON.stringify(bad));
    }
  });
});

describe("the words of a row", () => {
  it("counts devices", () => {
    assert.equal(countWords(1), "1 device");
    assert.equal(countWords(3), "3 devices");
  });

  it("says today, a day of this year, or a day of another year", () => {
    assert.equal(dayWords(TODAY, TODAY), "today");
    assert.equal(dayWords({ year: 2026, month: 11, day: 3 }, TODAY), "3 Nov");
    assert.equal(dayWords({ year: 2025, month: 1, day: 30 }, TODAY), "30 Jan 2025");
  });

  it("platform and version as sent, paired, last used or not used yet", () => {
    const d = devicesOf({ devices: [ROW] })![0];
    assert.equal(platformWords(d), "Windows, version 0.4.0");
    assert.equal(pairedWords({ year: 2026, month: 11, day: 3 }, TODAY), "Paired 3 Nov");
    assert.equal(lastUsedWords(null, TODAY), "Not used yet");
    assert.equal(lastUsedWords(TODAY, TODAY), "Last used today");
  });
});

describe("after DELETE devices/{id}", () => {
  it("means revoked, gone, ended or a plate", () => {
    assert.equal(revokeOutcome({ kind: "ok", status: 204, body: null }), "revoked");
    assert.equal(revokeOutcome({ kind: "refused", status: 404, code: "not_found" }), "gone");
    assert.equal(revokeOutcome({ kind: "not_signed_in" }), "ended");
    assert.deepEqual(revokeOutcome({ kind: "too_many", retryAfter: 30 }), { kind: "too-many", retryAfter: 30 });
    assert.deepEqual(revokeOutcome({ kind: "offline" }), { kind: "offline" });
    assert.deepEqual(revokeOutcome({ kind: "refused", status: 422, code: "invalid_request" }), { kind: "server" });
  });
});
