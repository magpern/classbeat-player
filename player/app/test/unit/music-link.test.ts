// The interface the clock will take music readings from (PL5), with its fake.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeMusicLink, isFresh, manualLink, positionNow, STALE_AFTER_MS } from "../../src/core/clock/index.ts";

const reading = { songIndex: 0, positionMs: 10_000, playing: true, at: 1000 };

test("the manual link never has a reading", () => {
  assert.equal(manualLink.kind, "manual");
  assert.equal(manualLink.latest(), null);
});

test("the fake link returns what was pushed, and nothing after clear", () => {
  const link = createFakeMusicLink();
  assert.equal(link.latest(), null);
  link.push(reading);
  assert.deepEqual(link.latest(), reading);
  link.clear();
  assert.equal(link.latest(), null);
});

for (const [now, fresh] of [
  [1000, true],
  [1000 + STALE_AFTER_MS, true],
  [1000 + STALE_AFTER_MS + 1, false],
  [999, false],
] as const) {
  test(`rule 8: a reading taken at 1000 is ${fresh ? "fresh" : "not fresh"} at ${now}`, () => {
    assert.equal(isFresh(reading, now), fresh);
  });
}

test("rule 8: a playing position is extrapolated from the moment it was updated", () => {
  assert.equal(positionNow(reading, 3500), 12_500);
  assert.equal(positionNow(reading, 500), 10_000);
});

test("rule 8: a paused position is not extrapolated", () => {
  assert.equal(positionNow({ ...reading, playing: false }, 9000), 10_000);
});
