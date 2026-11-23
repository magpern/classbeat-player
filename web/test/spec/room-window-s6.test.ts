// The strict S6 gate on the whole room window (issue #606; room-2d.md, "The flash budget on the plain screen"; scene.md,
// "The flash budget"): the real screen ticking (a countdown, a count at 120 and at 180 bpm) with the shell's own changes on
// top of it (the control band, the join sheet, a plate), here a bright block toggled at times a person would cause. The
// changes are drawn through `RoomScreen.requestMark`, which places them in the screen's own ledger. The measure is the
// scene's (40 regions, a change is a monotone run over 10 % of the larger end, more than 3 in any sliding second fails).
// The negative control draws the same changes at once, with no mark asked for, and must fail it.
//   SPEC_ONLY=<regex>   only the runs whose name ("<case>-<w>x<h>") matches
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import type { Scenario } from "../../src/fixtures/timeline.ts";
import { launch } from "../lib/browser.ts";
import { MAX_CHANGES_PER_SECOND, playS6 } from "../lib/room-s6.ts";

const SIZES = [[1280, 720], [1440, 1080]] as const;
const ONLY = process.env.SPEC_ONLY ? new RegExp(process.env.SPEC_ONLY) : null;
const MID = 1_099_000;
/** A mouse move shows the band, Esc hides it, the sheet comes and goes: changes 100 ms to 1 s apart, some within a tick of each other. */
const OUTSIDE = [1250, 1750, 2400, 2600, 3100, 3350, 4000, 4100, 4900, 5500, 5600, 6200, 6700, 7000, 7600, 8300, 8400, 9000];

const CASES: readonly { id: string; what: string; scenario: Scenario }[] = [
  { id: "count-120", what: "a count at 120 bpm: a tick every 500 ms", scenario: { fixture: "pattern", startMs: MID, bpm: 120, events: [] } },
  { id: "count-180", what: "a count at 180 bpm: the cap gives the count's cadence way", scenario: { fixture: "pattern", startMs: MID, bpm: 180, events: [] } },
  { id: "countdown", what: "no count: the countdown ticks each second", scenario: { fixture: "running", startMs: MID, events: [] } },
  { id: "count-120-change", what: "a count at 120 bpm across an interval change", scenario: { fixture: "pattern", startMs: 1_164_000, bpm: 120, events: [] } },
];

const runs = CASES.flatMap((c) => SIZES.map(([w, h]) => ({ ...c, name: `${c.id}-${w}x${h}`, size: [w, h] as const }))).filter((c) => !ONLY || ONLY.test(c.name));

describe("S6 on the whole room window: the screen's ticks and the shell's changes in one ledger", () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(async () => {
    await browser.close();
  });

  for (const c of runs) {
    it(`${c.name}: ${c.what}, with changes through requestMark`, async () => {
      const run = await playS6(browser, c.scenario, c.size, false, 10, { times: OUTSIDE });
      console.log(`S6 window, ${c.name}: ${run.most} changes in a second (${run.worstRegion}), ${run.marks.length} frames changed, ${run.frames} frames (limit ${MAX_CHANGES_PER_SECOND})`);
      assert.ok(run.most <= MAX_CHANGES_PER_SECOND, `${run.most} changes in a second in ${run.worstRegion}`);
      assert.deepEqual(run.moving, []);
      assert.equal(run.rafCalls, 0);
      // The block toggled 18 times and the screen ticked: every changed frame is at least 500 ms from the one before.
      for (let i = 1; i < run.marks.length; i += 1) assert.ok(run.marks[i] - run.marks[i - 1] >= 500 - 1e-6, `frames ${run.marks[i - 1].toFixed(1)} and ${run.marks[i].toFixed(1)} ms are less than 500 ms apart`);
      assert.ok(run.marks.length >= 12, "the screen and the block both changed");
    });

    it(`${c.name}: the negative control, the same changes drawn without asking for a mark, fails the gate`, async () => {
      const run = await playS6(browser, c.scenario, c.size, false, 10, { times: OUTSIDE, bypass: true });
      console.log(`S6 window, ${c.name}, bypassing the method: ${run.most} changes in a second (${run.worstRegion}) (limit ${MAX_CHANGES_PER_SECOND})`);
      assert.ok(run.most > MAX_CHANGES_PER_SECOND, `the control did not fail: ${run.most} changes in a second in ${run.worstRegion}`);
    });
  }
});
