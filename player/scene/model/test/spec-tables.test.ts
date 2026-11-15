// Scope items 1 and 6: the energy table and the quality table are held to scene.md itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ENERGY_BY_ZONE, MAX_BEAT_LIFT, MAX_DEG_PER_SECOND, TOTAL_FIXTURES, ZONES, energyFor } from "../src/energy.ts";
import { FIXTURES } from "../src/beams.ts";
import { QUALITY, litFixtures, stepDown } from "../src/quality.ts";

const spec = readFileSync(new URL("../../../../docs/design/scene.md", import.meta.url), "utf8");
const rows = (heading: string): string[][] => {
  const body = spec.split(heading)[1]!.split(/\n## /)[0]!;
  return body.split("\n").filter((l) => /^\| (\d|High|Medium|Low)/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
};

test("energy by zone equals the spec table, row by row", () => {
  const table = rows("### Energy by zone");
  assert.equal(table.length, 7);
  for (const [zone, glow, lit, deg, lift, wall] of table) {
    const e = energyFor(Number(zone));
    assert.equal(e.ambientGlow, Number(glow));
    assert.equal(e.lit, Number(lit));
    assert.equal(e.degPerSecond, Number(deg));
    assert.equal(e.beatLift, Number(lift!.replace(" %", "")) / 100);
    assert.equal(e.wall, wall!.toLowerCase().replace(",", "").replace("both ways", "both ways"));
  }
});

test("energy rises with the zone and respects the limits", () => {
  let prev = ENERGY_BY_ZONE[1];
  for (const z of ZONES.slice(1)) {
    const e = ENERGY_BY_ZONE[z];
    assert.ok(e.ambientGlow > prev.ambientGlow && e.lit > prev.lit && e.degPerSecond > prev.degPerSecond && e.beatLift > prev.beatLift);
    prev = e;
  }
  for (const z of ZONES) {
    assert.ok(energyFor(z).degPerSecond <= MAX_DEG_PER_SECOND && energyFor(z).beatLift <= MAX_BEAT_LIFT && energyFor(z).lit <= TOTAL_FIXTURES);
  }
  assert.equal(FIXTURES.length, TOTAL_FIXTURES);
  for (const bad of [0, 8, 1.5, NaN]) assert.throws(() => energyFor(bad), RangeError);
});

test("quality levels equal the spec table", () => {
  const table = rows("## Quality levels");
  assert.equal(table.length, 3);
  for (const [level, scale, fixtures, haze] of table) {
    const q = QUALITY[level as "High" | "Medium" | "Low"];
    assert.equal(q.renderScale, Number(scale!.split(" ")[0]));
    assert.equal(q.fixtures, Number(fixtures));
    assert.equal(q.hazeLayers, haze!.startsWith("Two") ? 2 : 1);
    assert.equal(q.wall, !haze!.includes("no wall"));
  }
  assert.equal(stepDown("High"), "Medium");
  assert.equal(stepDown("Medium"), "Low");
  assert.equal(stepDown("Low"), "Plain");
});

test("lit fixtures are the zone's count, capped by the quality level", () => {
  assert.equal(litFixtures(7, "High"), 22);
  assert.equal(litFixtures(7, "Medium"), 16);
  assert.equal(litFixtures(7, "Low"), 10);
  assert.equal(litFixtures(1, "Low"), 8);
});
