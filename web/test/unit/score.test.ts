import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STATE_FIXTURES } from "../../src/fixtures/states.ts";
import type { Class } from "../../src/room/input.ts";
import { MIN_BLOCK_W, NOW_X, NUMBER_FITS_UNTIL, VW_PER_S, layoutScore, ordinalText, scoreShiftVw, xAt } from "../../src/room/score.ts";
import type { ScoreInput } from "../../src/room/score.ts";

function scoreOf(name: string, patch: Partial<ScoreInput> = {}) {
  const { doc, view } = STATE_FIXTURES[name];
  assert.ok(doc && view);
  return layoutScore({ classMs: view.classMs, lengthMs: view.lengthMs, intervals: doc.intervals, songs: doc.songs, zoneName: (z) => `zone ${z}`, ambiguity: null, unsure: false, ...patch });
}

describe("score layout (the running mock-up at 18:19)", () => {
  const s = scoreOf("running");

  it("is 7.6 minutes wide with 'now' at 25 %: 13.2 vw a minute, 1.9 minutes behind and 5.7 ahead", () => {
    assert.equal(xAt(1_099_000, 1_099_000), NOW_X);
    assert.equal(Math.round(xAt(1_099_000 + 60_000, 1_099_000) * 1e6) / 1e6, 38.2); // a minute is 13.2 vw
    assert.ok(Math.abs((NOW_X / VW_PER_S) / 60 - 1.894) < 0.001, "behind");
    assert.ok(Math.abs(((100 - NOW_X) / VW_PER_S) / 60 - 5.682) < 0.001, "ahead, to the screen's edge");
    // The last block that is drawn with its number begins 5.0 minutes ahead (91 vw).
    assert.ok(Math.abs(((NUMBER_FITS_UNTIL - NOW_X) / VW_PER_S) / 60 - 5) < 0.001);
  });

  it("draws every interval that begins within five minutes of 'now', with its number", () => {
    const at = 1_099_000;
    const doc = STATE_FIXTURES.running.doc as Class;
    const mk = (offsetS: number): Class["intervals"][number] => ({ start_ms: at + offsetS * 1000, length_ms: 60_000, zone: 5, cue: "x" });
    const s = layoutScore({ classMs: at, lengthMs: at + 600_000, intervals: [mk(299), mk(301)], songs: doc.songs, zoneName: () => "n", ambiguity: null, unsure: false });
    assert.deepEqual(s.blocks.map((b) => b.left), [90.78]);
  });

  it("places the intervals and keeps a begun block's label just right of 'now'", () => {
    const [z4, z2, z5, z3, last] = s.blocks;
    assert.deepEqual([z4.zone, z4.left, z4.width, z4.padLeft], [4, 20.6, 19.8, 5.2]);
    assert.deepEqual([z2.zone, z2.left, z2.width, z2.padLeft, z2.padRight], [2, 40.4, 9.9, null, null]);
    assert.deepEqual([z5.zone, z5.left, z5.width], [5, 50.3, 19.8]);
    assert.deepEqual([z3.zone, z3.left, z3.width, z3.padRight], [3, 70.1, 19.8, null]);
    // The block that crosses the safe edge keeps its label inside it.
    assert.deepEqual([last.zone, last.left, last.padRight], [4, 89.9, 60.9]);
  });

  it("draws everything wholly in the past as one grey block, with no zone", () => {
    assert.ok(s.gone);
    assert.equal(Math.round((s.gone.left + s.gone.width) * 100) / 100, 20.6);
  });

  it("places the songs, their phrase ticks and a moment", () => {
    const [neon, pulse] = s.clips.slice(-3, -1);
    assert.deepEqual([neon.title, neon.artist, neon.bpm, neon.left, neon.padLeft, neon.phrase], ["Neon Avenue", "The Midnight Riders", 128, -7.34, 33.14, 1.65]);
    assert.deepEqual([pulse.title, pulse.left, pulse.padRight], ["Pulse Theory", 40.4, 0.18]);
    assert.deepEqual(s.moments, [{ left: 50.3, label: "Drop" }]);
  });

  it("clips wholly in the past carry no label", () => {
    const past = scoreOf("last-interval").clips.filter((c) => c.left + c.width <= NOW_X);
    assert.ok(past.length > 0);
    for (const c of past) assert.deepEqual([c.title, c.artist, c.bpm], [null, null, null]);
  });

  it("a song that begins too near the safe edge for a title carries none", () => {
    // At 3:04 the third song begins at 90 vw: 3.4 vw are left inside the safe edge, 8 are needed.
    const before = scoreOf("before-start", { classMs: 184_550 });
    const third = before.clips.find((c) => Math.abs(c.left - 90) < 0.02);
    assert.ok(third);
    assert.equal(third.title, null);
  });
});

describe("score rules", () => {
  it("'now' is dashed only while the clock guesses", () => {
    assert.equal(scoreOf("running").unsure, false);
    assert.equal(scoreOf("running", { unsure: true }).unsure, true);
  });

  it("an ambiguous recording says which occurrence the clip is, and drops the artist", () => {
    const s = scoreOf("running", { ambiguity: [5, 9] });
    const clip = s.clips.find((c) => c.title === "Neon Avenue");
    assert.equal(clip?.title, "Neon Avenue");
    assert.equal(clip?.occurrence, "1st of 2");
    assert.equal(clip?.artist, null);
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinalText), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });

  it("a zone colour always carries its whole number: narrow or late blocks are not drawn in colour", () => {
    const doc = STATE_FIXTURES.running.doc as Class;
    const at = 1_099_000;
    const mk = (offsetS: number, lengthS: number): Class["intervals"][number] => ({ start_ms: at + offsetS * 1000, length_ms: lengthS * 1000, zone: 5, cue: "x" });
    const input: ScoreInput = { classMs: at, lengthMs: at + 600_000, intervals: [mk(-10, 10), mk(0, 6), mk(6, 90), mk(310, 90)], songs: doc.songs, zoneName: () => "n", ambiguity: null, unsure: false };
    const s = layoutScore(input);
    // 6 s is 1.67 vw: too narrow for a number, so it is a neutral sliver, not a colour.
    assert.equal(s.slivers.length, 1);
    assert.ok(s.slivers[0].width < MIN_BLOCK_W);
    // The 250 s interval begins at 80 vw, inside; one 310 s ahead (93 vw) has no room for its number inside the safe area.
    assert.ok(xAt(at + 310_000, at) > NUMBER_FITS_UNTIL);
    assert.deepEqual(s.blocks.map((b) => b.left), [xAt(at + 6000, at)].map((v) => Math.round(v * 100) / 100));
  });

  it("the current block's last seconds are a neutral sliver: its number never sits half hidden at 'now'", () => {
    const doc = STATE_FIXTURES.running.doc as Class;
    const left = (secs: number) => {
      const at = 1_169_000 - secs * 1000; // the Threshold interval ends at 19:29
      return layoutScore({ classMs: at, lengthMs: 2_520_000, intervals: doc.intervals, songs: doc.songs, zoneName: () => "n", ambiguity: null, unsure: false });
    };
    for (const secs of [3, 4.5, 8]) {
      const s = left(secs);
      assert.ok(!s.blocks.some((b) => b.zone === 4 && b.left < NOW_X), `${secs} s left: zone 4 still drawn in colour`);
      assert.ok(s.slivers.some((g) => g.left < NOW_X), `${secs} s left: no sliver`);
    }
    assert.ok(left(30).blocks.some((b) => b.zone === 4 && b.left < NOW_X), "30 s left: the number fits");
    // Every drawn block has MIN_BLOCK_W vw ahead of 'now'.
    for (const b of left(11).blocks) assert.ok(b.left + b.width - Math.max(b.left, NOW_X) >= MIN_BLOCK_W);
  });

  it("the End mark appears when the end of the class is on the score, inside the safe area", () => {
    assert.equal(scoreOf("last-interval").endLeft, 58);
    assert.equal(scoreOf("finished").endLeft, 25);
    assert.equal(scoreOf("running").endLeft, null);
  });

  it("the strip moves 0.22 vw a second, in whole-second steps with reduced motion", () => {
    assert.equal(VW_PER_S, 0.22);
    assert.ok(Math.abs(scoreShiftVw(1000, false) - 0.22) < 1e-9);
    assert.ok(Math.abs(scoreShiftVw(60_000, false) - 13.2) < 1e-9, "13.2 vw a minute");
    assert.equal(scoreShiftVw(1500, true), scoreShiftVw(1000, true));
    assert.equal(scoreShiftVw(999, true), 0);
    assert.equal(scoreShiftVw(-5, false), 0);
  });
});
