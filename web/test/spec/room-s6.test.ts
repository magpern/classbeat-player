// The strict S6 gate on the plain screen (docs/design/room-2d.md, "Motion and reduced motion"; scene.md,
// "The flash budget"; issue #583): the real screen in headless Chrome, the states of "States" with a count
// running, with the beat but no count, and without the beat, with reduced motion off and on, at 16:9 and at
// 4:3. 40 regions; a change is any monotone run over 10 % of its larger end; more than 3 changes in any
// sliding second fails. Every gated run is reported (and written to screenshots/room-s6.json for the PR).
//   SPEC_ONLY=<regex>   only the runs whose name ("<scenario>-<w>x<h>") matches
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import type { Scenario } from "../../src/fixtures/timeline.ts";
import { WEB_DIR, launch } from "../lib/browser.ts";
import { MAX_CHANGES_PER_SECOND, playS6 } from "../lib/room-s6.ts";
import type { S6Run } from "../lib/room-s6.ts";

const SIZES = [[1280, 720], [1440, 1080]] as const; // 16:9 and 4:3
const ONLY = process.env.SPEC_ONLY ? new RegExp(process.env.SPEC_ONLY) : null;
const BEFORE_CHANGE = 1_160_000; // 9 s before the Threshold interval ends (at 1169 s), so the change, "Change in" and the next row are in the run
const MID = 1_099_000;

interface Case {
  readonly id: string;
  readonly what: string;
  readonly scenario: Scenario;
  readonly seconds: number;
}

const CASES: readonly Case[] = [
  { id: "locked-no-count", what: "running, locked with the beat, no count: the countdown, the bars line, the change frame, 'Change in'", scenario: { fixture: "running", startMs: BEFORE_CHANGE, events: [] }, seconds: 12 },
  { id: "count-128", what: "a count running at 128 bpm across the interval change (next interval has its own pattern)", scenario: { fixture: "pattern", startMs: BEFORE_CHANGE, events: [] }, seconds: 12 },
  { id: "count-60", what: "a count running at 60 bpm", scenario: { fixture: "pattern", startMs: MID, bpm: 60, events: [] }, seconds: 12 },
  { id: "count-180", what: "a count running at 180 bpm: the cap gives the count's cadence way", scenario: { fixture: "pattern", startMs: MID, bpm: 180, events: [] }, seconds: 10 },
  { id: "count-tempo-only", what: "a count at tempo only (no anchors)", scenario: { fixture: "pattern-tempo-only", startMs: MID, events: [] }, seconds: 10 },
  { id: "count-next-bar", what: "a pattern that starts on the next bar, then counts", scenario: { fixture: "pattern-next-bar", startMs: MID, events: [] }, seconds: 10 },
  { id: "coasting", what: "no beat: coasting, the clock only guesses", scenario: { fixture: "coasting", startMs: BEFORE_CHANGE, events: [] }, seconds: 12 },
  { id: "off-list", what: "no beat: off the list", scenario: { fixture: "off-list", startMs: BEFORE_CHANGE, events: [] }, seconds: 12 },
  { id: "manual", what: "no beat: the manual clock", scenario: { fixture: "manual", startMs: BEFORE_CHANGE, events: [] }, seconds: 12 },
  { id: "pause-resume", what: "user actions: pause, resume 200 ms later, pause, resume 600 ms later, pause", scenario: { fixture: "running", startMs: MID, events: [{ atMs: 2000, do: "pause" }, { atMs: 2200, do: "resume" }, { atMs: 2300, do: "pause" }, { atMs: 2900, do: "resume" }, { atMs: 3000, do: "pause" }] }, seconds: 8 },
  { id: "pause-resume-count", what: "user actions under a count: pause and resume near count ticks", scenario: { fixture: "pattern", startMs: MID, events: [{ atMs: 1900, do: "pause" }, { atMs: 2150, do: "resume" }, { atMs: 3000, do: "pause" }, { atMs: 3400, do: "resume" }] }, seconds: 8 },
  { id: "paused", what: "paused: actions and a seek, no ticks", scenario: { fixture: "paused", startMs: MID, events: [{ atMs: 1500, do: "resume" }, { atMs: 2100, do: "pause" }, { atMs: 2300, do: "seek", toMs: 1_020_000 }, { atMs: 3500, do: "link", state: "Locked" }] }, seconds: 7 },
  { id: "seek-jump", what: "a seek across a change, then a jump back, a plate in the same second", scenario: { fixture: "running", startMs: MID, events: [{ atMs: 1000, do: "seek", toMs: 1_168_900 }, { atMs: 1400, do: "seek", toMs: 1_100_000 }, { atMs: 3000, do: "seek", toMs: 1_130_000 }] }, seconds: 6 },
  { id: "before-start", what: "before the start: Start, then a pause", scenario: { fixture: "before-start", events: [{ atMs: 1200, do: "start" }, { atMs: 2000, do: "pause" }] }, seconds: 5 },
  { id: "finished", what: "the class's end is a change frame, then nothing ticks", scenario: { fixture: "running", startMs: 2_517_000, events: [] }, seconds: 6 },
  { id: "link-states", what: "timed and outside changes: the link goes Coasting, Off the list, Locked", scenario: { fixture: "running", startMs: MID, events: [{ atMs: 1500, do: "link", state: "Coasting" }, { atMs: 2100, do: "link", state: "Off the list" }, { atMs: 2700, do: "link", state: "Locked" }] }, seconds: 6 },
  { id: "sub-second", what: "intervals 0.3 s and 0.4 s apart merge into one change frame", scenario: { fixture: "running", startMs: 1_166_000, tinyAtMs: 1_169_000, events: [] }, seconds: 7 },
  { id: "sub-second-count", what: "sub-second intervals under a count, with an action in the same second", scenario: { fixture: "pattern", startMs: 1_166_000, tinyAtMs: 1_169_000, events: [{ atMs: 3200, do: "pause" }] }, seconds: 7 },
];

const shown = CASES.flatMap((c) => SIZES.map(([w, h]) => ({ ...c, name: `${c.id}-${w}x${h}`, size: [w, h] as const }))).filter((c) => !ONLY || ONLY.test(c.name));
const report: { name: string; reduced: boolean; run: S6Run }[] = [];

describe("S6 on the plain screen: the strict gate (room-2d.md; scene.md, 'The flash budget')", () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(async () => {
    await browser.close();
    if (report.length === 0) return;
    const dir = join(WEB_DIR, "screenshots");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "room-s6.json"), JSON.stringify({ limitPerSecond: MAX_CHANGES_PER_SECOND, runs: report.map((r) => ({ name: r.name, reducedMotion: r.reduced, marks: r.run.marks.length, most: r.run.most, worstRegion: r.run.worstRegion, changes: r.run.worstChanges })) }, null, 2));
  });

  it("has runs to measure", () => {
    assert.ok(shown.length > 0, "SPEC_ONLY matched no run");
  });

  for (const c of shown) {
    it(`${c.name}: ${c.what}`, async () => {
      const runs: S6Run[] = [];
      for (const reduced of [false, true]) {
        const run = await playS6(browser, c.scenario, c.size, reduced, c.seconds);
        runs.push(run);
        report.push({ name: c.name, reduced, run });
        console.log(`S6 room, ${c.name}, reduced motion ${reduced ? "on " : "off"}: ${run.most} changes in a second (${run.worstRegion}), ${run.marks.length} marks, ${run.frames} frames (limit ${MAX_CHANGES_PER_SECOND})`);
        assert.ok(run.most <= MAX_CHANGES_PER_SECOND, `${run.most} changes in a second in ${run.worstRegion}`);
        assert.ok(run.marks.length >= 1, "measured nothing: the screen never changed");
        assert.deepEqual(run.moving, [], "something transitions or animates");
        assert.equal(run.rafCalls, 0, "a frame loop runs on the room screen");
        for (let i = 1; i < run.marks.length; i += 1) assert.ok(run.marks[i] - run.marks[i - 1] >= 500 - 1e-6, `marks ${run.marks[i - 1].toFixed(1)} and ${run.marks[i].toFixed(1)} ms are less than 500 ms apart`);
      }
      // Reduced motion shows the same marks: there is nothing to remove.
      assert.deepEqual(runs[1].marks, runs[0].marks, "reduced motion changes where the marks fall");
    });
  }
});
