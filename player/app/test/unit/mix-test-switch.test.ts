// The end-to-end tests' `--test-fake-mix` switch (main/mix/test-mix.ts): a packaged build refuses
// it without reading it, and the shell takes the test source, vault and account only behind it.
// test-mix.ts stays in the bundle: the packaged app is built from the same dist the end-to-end
// tests run, so the switch is what keeps it off, and this pins that.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TEST_MIX_SWITCH, testMixOn } from "../../src/main/mix/test-mix.ts";

const SRC = join(import.meta.dirname, "..", "..", "src");
const app = (isPackaged: boolean, has: boolean) => {
  const read: string[] = [];
  return { read, a: { isPackaged, commandLine: { hasSwitch: (n: string) => (read.push(n), has) } } };
};

test("the switch is refused when app.isPackaged, and counts only in an unpackaged build", () => {
  const packaged = app(true, true);
  assert.equal(testMixOn(packaged.a), false);
  assert.deepEqual(packaged.read, [], "a packaged build does not even read it");
  const dev = app(false, true);
  assert.equal(testMixOn(dev.a), true);
  assert.deepEqual(dev.read, [TEST_MIX_SWITCH]);
  assert.equal(testMixOn(app(false, false).a), false);
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** What breaks the pin in setup.ts's source, or null. */
function switchViolation(setup: string): string | null {
  if (!/^ {2}const test = testMixOn\(app\);$/m.test(setup)) return "the switch is not read through testMixOn(app)";
  if (/TEST_MIX_SWITCH|hasSwitch/.test(setup)) return "the switch is read directly";
  const uses = [...setup.matchAll(/\b(TEST_ACCOUNT|testMixSource|testMixVault)\b/g)].length;
  const guarded = [...setup.matchAll(/test \? (?:testMixSource\(\)|testMixVault\(root\)|\(\) => TEST_ACCOUNT) :/g)].length;
  // One import line names the three; every other use is behind `test ?`.
  if (uses !== 3 + guarded || guarded !== 3) return "a test export is used outside `test ?`";
  return null;
}

test("setup.ts takes the test source, vault and account only behind the switch; nothing else in src does", () => {
  const setupPath = join(SRC, "main", "mix", "setup.ts");
  const setup = readFileSync(setupPath, "utf8");
  assert.equal(switchViolation(setup), null);
  for (const f of files(SRC)) {
    if (f === setupPath || f.endsWith(join("mix", "test-mix.ts"))) continue;
    const text = readFileSync(f, "utf8");
    assert.ok(!/test-mix(\.ts)?["']/.test(text), `${f} imports test-mix`);
    assert.ok(!text.includes(TEST_MIX_SWITCH), `${f} names the switch`);
  }
});

test("the pin fails on a violation", () => {
  const setup = readFileSync(join(SRC, "main", "mix", "setup.ts"), "utf8");
  assert.notEqual(switchViolation(setup.replace("const test = testMixOn(app);", "const test = app.commandLine.hasSwitch(TEST_MIX_SWITCH);")), null);
  assert.notEqual(switchViolation(setup.replace("test ? testMixSource() :", "true ? testMixSource() :")), null);
  assert.notEqual(switchViolation(`${setup}\nconst x = TEST_ACCOUNT;\n`), null);
});
