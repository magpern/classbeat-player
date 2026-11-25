// The rollback rule (ADR 0014, section 4; issue #797): every step of the marker's life.
import assert from "node:assert/strict";
import { test } from "node:test";
import { markerCleared, markerWritten, mayOffer, NO_ROLLBACK, started } from "../../src/core/update/rollback.ts";
import type { RollbackState } from "../../src/core/update/rollback.ts";

test("no marker: a start runs the installed version", () => {
  assert.deepEqual(started(NO_ROLLBACK), { state: NO_ROLLBACK, action: { action: "start" } });
});

test("marker written, first start tries the new version, the new version clears it", () => {
  let s = markerWritten(NO_ROLLBACK, "1.1.0");
  assert.deepEqual(s.marker, { version: "1.1.0", found: 0 });
  const first = started(s);
  assert.deepEqual(first.action, { action: "try new", version: "1.1.0" });
  s = markerCleared(first.state, "1.1.0");
  assert.deepEqual(s, NO_ROLLBACK);
  assert.deepEqual(started(s).action, { action: "start" }); // later starts are ordinary
});

test("the same marker found twice in a row reverts and skips that version", () => {
  const first = started(markerWritten(NO_ROLLBACK, "1.1.0"));
  const second = started(first.state); // the new version never cleared its marker
  assert.deepEqual(second.action, { action: "revert", version: "1.1.0" });
  assert.deepEqual(second.state, { marker: null, skipped: "1.1.0" });
  assert.deepEqual(started(second.state).action, { action: "start" }); // the kept version starts as usual afterwards
});

test("a marker naming another version is not cleared by this one", () => {
  const s = started(markerWritten(NO_ROLLBACK, "1.1.0")).state;
  assert.deepEqual(markerCleared(s, "1.0.0"), s);
  assert.deepEqual(markerCleared(NO_ROLLBACK, "1.1.0"), NO_ROLLBACK);
});

test("a skipped version is offered again only when a higher one appears", () => {
  const skipped: RollbackState = { marker: null, skipped: "1.1.0" };
  const cases: [string, boolean][] = [
    ["1.1.0", false],
    ["1.1.0+rebuild", false], // the same precedence
    ["1.0.9", false],
    ["1.1.0-rc.2", false],
    ["1.1.1-rc.1", true],
    ["1.1.1", true],
    ["2.0.0", true],
    ["not-semver", false],
  ];
  for (const [version, want] of cases) assert.equal(mayOffer(skipped, version), want, version);
  assert.equal(mayOffer(NO_ROLLBACK, "1.1.0"), true);
  assert.equal(mayOffer(NO_ROLLBACK, "1.1.0/../x"), false);
});

test("writing a marker for a version that may not be offered is refused", () => {
  const skipped: RollbackState = { marker: null, skipped: "1.1.0" };
  assert.equal(markerWritten(skipped, "1.1.0"), skipped);
  assert.equal(markerWritten(skipped, "1.0.0"), skipped);
  assert.equal(markerWritten(NO_ROLLBACK, "1.1.0?a=b"), NO_ROLLBACK);
  // A higher version gets its own marker and its own two tries.
  const next = markerWritten(skipped, "1.2.0");
  assert.deepEqual(next, { marker: { version: "1.2.0", found: 0 }, skipped: "1.1.0" });
  const twice = started(started(next).state);
  assert.deepEqual(twice.state, { marker: null, skipped: "1.2.0" });
});

test("a newer marker replaces a pending one and starts its count again", () => {
  const pending = started(markerWritten(NO_ROLLBACK, "1.1.0")).state;
  const replaced = markerWritten(pending, "1.2.0");
  assert.deepEqual(replaced.marker, { version: "1.2.0", found: 0 });
  assert.deepEqual(started(replaced).action, { action: "try new", version: "1.2.0" });
});
