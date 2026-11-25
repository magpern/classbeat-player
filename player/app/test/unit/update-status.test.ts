// The update status, the release page address and the class gate (ADR 0014, sections 2, 3 and
// 5; issue #797).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { classChanged, midClass, NO_CLASS, statusArrived, visible } from "../../src/core/update/class-gate.ts";
import { readFeed } from "../../src/core/update/feed.ts";
import { checking, couldNotCheck, releasePageAddress, statusAfter } from "../../src/core/update/status.ts";
import type { UpdateStatus } from "../../src/core/update/status.ts";
import { REPO } from "./fixtures.ts";

const feed = (name: string) => readFeed(readFileSync(join(REPO, "player", "app", "test", "fixtures", "updates", name), "utf8"));
const PAGE = "https://github.com/magpern/classbeat-player/releases/tag/player-v";

test("the status after a check: newer, up to date or could not check, with both versions", () => {
  const cases: [string, string, boolean, UpdateStatus][] = [
    ["releases.json", "1.2.0", false, { kind: "newer", current: "1.2.0", latest: "1.2.1" }],
    ["releases.json", "1.2.0", true, { kind: "newer", current: "1.2.0", latest: "1.3.0-rc.1" }],
    ["releases.json", "1.2.1", false, { kind: "up to date", current: "1.2.1", latest: "1.2.1" }], // equal
    ["releases.json", "1.5.0", true, { kind: "up to date", current: "1.5.0", latest: "1.3.0-rc.1" }], // older
    ["releases.json", "1.3.0-rc.1", false, { kind: "up to date", current: "1.3.0-rc.1", latest: "1.2.1" }],
    ["prerelease-only.json", "0.9.0", false, { kind: "up to date", current: "0.9.0", latest: null }],
    ["prerelease-only.json", "0.9.0", true, { kind: "newer", current: "0.9.0", latest: "1.0.0-beta.10" }],
    ["empty.json", "0.9.0", true, { kind: "up to date", current: "0.9.0", latest: null }],
    ["not-array.json", "0.9.0", true, { kind: "could not check", current: "0.9.0", latest: null }],
    ["wrong-shape.json", "0.9.0", false, { kind: "could not check", current: "0.9.0", latest: null }],
    ["releases.json", "dev", false, { kind: "could not check", current: "dev", latest: null }], // a running version that is not SemVer
  ];
  for (const [name, current, pre, want] of cases) assert.deepEqual(statusAfter(current, feed(name), pre), want, `${name} ${current} pre=${pre}`);
  assert.deepEqual(checking("1.2.0"), { kind: "checking", current: "1.2.0", latest: null });
});

test("the release page is built from the checked version only, and only for 'newer'", () => {
  assert.equal(releasePageAddress(statusAfter("1.2.0", feed("releases.json"), false)), `${PAGE}1.2.1`);
  assert.equal(releasePageAddress(statusAfter("1.2.0", feed("releases.json"), true)), `${PAGE}1.3.0-rc.1`);
  // The reply's html_url for 1.2.1 and 1.3.0-rc.1 points elsewhere; it is never used.
  const none: (UpdateStatus | null)[] = [
    null,
    checking("1.2.0"),
    couldNotCheck("1.2.0"),
    statusAfter("1.2.1", feed("releases.json"), false),
    { kind: "up to date", current: "1.0.0", latest: "2.0.0" },
  ];
  for (const s of none) assert.equal(releasePageAddress(s), null, JSON.stringify(s));
});

test("a crafted, non-SemVer, equal or older version never becomes an address", () => {
  const crafted = [
    "1.0.0/../x", "1.0.0?a=b", "1.0.0#top", "1.0.0/../../../../evil", "1.0.0%2F..%2Fx", "1.0.0\n", " 1.0.0", "1.0.0 ",
    "1.0", "v1.0.0", "01.0.0", "https://evil.example/", "//evil.example", "1.0.0@evil.example", "", "１.0.0",
  ];
  for (const latest of crafted) assert.equal(releasePageAddress({ kind: "newer", current: "0.1.0", latest }), null, JSON.stringify(latest));
  for (const latest of ["0.1.0", "0.0.9", "0.1.0+build", "0.1.0-rc.1", null]) {
    assert.equal(releasePageAddress({ kind: "newer", current: "0.1.0", latest }), null, String(latest));
  }
  assert.equal(releasePageAddress({ kind: "newer", current: "dev", latest: "1.0.0" }), null);
  assert.equal(releasePageAddress({ kind: "newer", current: "0.1.0", latest: "1.0.0" }), `${PAGE}1.0.0`);
});

test("the class gate: playing or paused mid-class holds the result until the class ends", () => {
  const [old, next, later] = [checking("1.0.0"), { kind: "newer", current: "1.0.0", latest: "1.1.0" } as const, couldNotCheck("1.0.0")];
  let g = statusArrived(NO_CLASS, old);
  assert.equal(visible(g), old); // outside a class: shown at once
  g = classChanged(g, true);
  assert.equal(visible(g), null); // nothing is shown during a class
  g = statusArrived(g, next);
  assert.equal(visible(g), null); // a check that ends during the class keeps its result
  g = classChanged(g, true); // paused, resumed: still in the class
  assert.equal(visible(g), null);
  g = classChanged(g, false);
  assert.equal(visible(g), next); // released when the class ends
  g = classChanged(g, true);
  g = statusArrived(g, next);
  g = statusArrived(g, later);
  assert.equal(visible(classChanged(g, false)), later); // the newest held result wins
  assert.equal(visible(classChanged(classChanged(NO_CLASS, true), false)), null); // nothing held, nothing checked
  assert.equal(visible(classChanged(classChanged(statusArrived(NO_CLASS, old), true), false)), old); // nothing held: the last shown stays
  assert.equal(releasePageAddress(visible(classChanged(statusArrived(NO_CLASS, next), true))), null); // no address during a class
});

test("mid-class means playing or paused; ready, ended and no class are not", () => {
  const cases: [Parameters<typeof midClass>[0], boolean][] = [["running", true], ["paused", true], ["ready", false], ["ended", false], [null, false]];
  for (const [clock, want] of cases) assert.equal(midClass(clock), want, String(clock));
});
