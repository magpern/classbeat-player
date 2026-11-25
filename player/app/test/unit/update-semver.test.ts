// The updater's SemVer check and precedence (ADR 0014, sections 1 and 2; issue #797).
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, isNewer, isPrerelease, MAX_VERSION_LENGTH, parseVersion } from "../../src/core/update/semver.ts";
import type { Version } from "../../src/core/update/semver.ts";

const v = (text: string): Version => {
  const p = parseVersion(text);
  assert.ok(p, `${text} should parse`);
  return p;
};

test("valid SemVer versions parse, with their pre-release part", () => {
  const cases: [string, readonly string[]][] = [
    ["0.0.0", []],
    ["1.2.3", []],
    ["10.20.30", []],
    ["1.0.0-alpha", ["alpha"]],
    ["1.0.0-rc.1", ["rc", "1"]],
    ["1.0.0-0A.is.legal", ["0A", "is", "legal"]],
    ["1.0.0-x-y-z.--", ["x-y-z", "--"]],
    ["1.0.0+build.7", []],
    ["1.0.0-beta+exp.sha.5114f85", ["beta"]],
    ["99999999999999999999.0.0", []],
  ];
  for (const [text, pre] of cases) {
    assert.deepEqual(v(text).pre, pre, text);
    assert.equal(v(text).text, text);
    assert.equal(isPrerelease(v(text)), pre.length > 0, text);
  }
});

test("anything that is not exactly one SemVer version is refused", () => {
  const bad: unknown[] = [
    "", "1", "1.2", "1.2.3.4", "v1.2.3", "01.2.3", "1.02.3", "1.2.03", "1.0.0-01", "1.0.0-", "1.0.0+", "1.0.0-a..b",
    "1.0.0-a_b", " 1.0.0", "1.0.0 ", "1.0.0\n", "\n1.0.0", "1.0.0/../x", "1.0.0?a=b", "1.0.0#x", "1.0.0%2F", "1.0.0/x",
    "1.0.0\\x", "1.0.0-a:b", "１.0.0", "1.0.0-é", `1.0.0-${"a".repeat(MAX_VERSION_LENGTH)}`, 1, null, undefined, ["1.0.0"],
  ];
  for (const raw of bad) assert.equal(parseVersion(raw), null, JSON.stringify(raw));
});

test("precedence follows SemVer: each version is lower than the next", () => {
  // The order from semver.org section 11, with numeric, length and core cases added.
  const ordered = [
    "0.9.9", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11",
    "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "1.9.0", "1.10.0", "2.0.0", "10.0.0", "99999999999999999999.0.0",
  ];
  for (let i = 0; i + 1 < ordered.length; i++) {
    const [lo, hi] = [v(ordered[i]!), v(ordered[i + 1]!)];
    assert.ok(compareVersions(lo, hi) < 0, `${lo.text} < ${hi.text}`);
    assert.ok(compareVersions(hi, lo) > 0, `${hi.text} > ${lo.text}`);
  }
});

test("only a strictly higher version is newer: equal and older ones are not", () => {
  const cases: [string, string, boolean][] = [
    ["1.2.4", "1.2.3", true],
    ["1.2.3", "1.2.3", false],
    ["1.2.3+other", "1.2.3+build", false], // build metadata has no precedence
    ["1.2.2", "1.2.3", false],
    ["1.2.3-rc.1", "1.2.3", false],
    ["1.2.3", "1.2.3-rc.1", true],
    ["1.0.0-beta.10", "1.0.0-beta.2", true],
    ["100000000000000000001.0.0", "100000000000000000000.0.0", true], // beyond Number's precision
  ];
  for (const [candidate, current, newer] of cases) assert.equal(isNewer(v(candidate), v(current)), newer, `${candidate} vs ${current}`);
});
