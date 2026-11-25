// A mix class's clock: it never uses the Spotify music link (core/link/plan.ts), and the shell
// moves it to the audio's class time only while it runs (core/player-state.ts alignClock).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { linkPlanFrom } from "../../src/core/link/plan.ts";
import { alignClock, command, INITIAL, openText, snapshotOf } from "../../src/core/player-state.ts";
import { classSchema, EXAMPLES, loadExample } from "./fixtures.ts";

const MIX = join("valid", "class-swedebeat-mix-no-offset-exact-fit.json");
const text = readFileSync(join(EXAMPLES, MIX), "utf8");

test("a Swedebeat class that names a mix is manual-only for the music link; one without a mix is not changed", () => {
  const doc = loadExample(MIX);
  assert.equal(linkPlanFrom(doc).manualOnly, true);
  const noMix = { ...doc, music: { ...doc.music, swedebeat_mix: undefined } } as typeof doc;
  assert.equal(linkPlanFrom(noMix).manualOnly, linkPlanFrom({ ...noMix, music: { ...noMix.music, source: "spotify" } } as typeof doc).manualOnly);
});

test("alignClock moves a running clock to the audio's class time", () => {
  let s = openText(INITIAL, "m.json", text, classSchema, 0);
  s = command(s, { type: "start" }, 0);
  s = alignClock(s, 12_345, 1_000);
  assert.equal(snapshotOf(s, 1_000).view?.classMs, 12_345);
  assert.equal(snapshotOf(s, 2_000).view?.classMs, 13_345, "and runs on from there");
  assert.equal(snapshotOf(s, 2_000).view?.status, "running");
});

test("alignClock leaves a clock that is ready, paused or ended, and no class, as it is", () => {
  assert.equal(alignClock(INITIAL, 5_000, 0), INITIAL);
  let s = openText(INITIAL, "m.json", text, classSchema, 0);
  assert.equal(alignClock(s, 5_000, 0), s, "ready");
  s = command(s, { type: "start" }, 0);
  s = command(s, { type: "pause" }, 1_000);
  assert.equal(alignClock(s, 5_000, 1_500), s, "paused");
});
