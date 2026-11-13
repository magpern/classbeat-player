import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STATE_FIXTURES } from "../../src/fixtures/states.ts";
import type { Class } from "../../src/room/input.ts";
import { MIN_BLOCK_W, NOW_X, NUMBER_FITS_UNTIL, layoutScore, ordinalText, scoreShiftVw, xAt } from "../../src/room/score.ts";
import type { ScoreInput } from "../../src/room/score.ts";

function scoreOf(name: string, patch: Partial<ScoreInput> = {}) {
  const { doc, view } = STATE_FIXTURES[name];
  assert.ok(doc && view);
  return layoutScore({ classMs: view.classMs, lengthMs: view.lengthMs, intervals: doc.intervals, songs: doc.songs, zoneName: (z) => `zone ${z}`, ambiguity: null, unsure: false, ...patch });
}

describe("score layout (the running mock-up at 18:19)", () => {
  const s = scoreOf("running");

  it("is six minutes wide with 'now' at 25 %", () => {
    assert.equal(xAt(1_099_000, 1_099_000), NOW_X);
    assert.equal(xAt(1_099_000 + 90_000, 1_099_000), 50); // 90 s is 25 vw
  });

  it("places the intervals and keeps a begun block's label just right of 'now'", () => {
    const [z4, z2, z5, z3] = s.blocks;
    assert.deepEqual([z4.zone, z4.left, z4.width, z4.padLeft], [4, 19.44, 25, 6.36]);
    assert.deepEqual([z2.zone, z2.left, z2.width, z2.padLeft, z2.padRight], [2, 44.44, 12.5, null, null]);
    assert.deepEqual([z5.zone, z5.left, z5.width], [5, 56.94, 25]);
    // The block that crosses the safe edge keeps its label inside it.
    assert.deepEqual([z3.zone, z3.left, z3.padRight], [3, 81.94, 11.94]);
  });

  it("draws everything wholly in the past as one grey block, with no zone", () => {
    assert.ok(s.gone);
    assert.equal(Math.round((s.gone.left + s.gone.width) * 100) / 100, 19.44);
  });

  it("places the songs, their phrase ticks and a moment", () => {
    const [neon, pulse] = s.clips.slice(-2);
    assert.deepEqual([neon.title, neon.artist, neon.bpm, neon.left, neon.padLeft, neon.phrase], ["Neon Avenue", "The Midnight Riders", 128, -15.83, 41.63, 2.083]);
    assert.deepEqual([pulse.title, pulse.left, pulse.padRight], ["Pulse Theory", 44.44, 18.61]);
    assert.deepEqual(s.moments, [{ left: 56.94, label: "Drop" }]);
  });

  it("clips wholly in the past carry no label", () => {
    const past = scoreOf("last-interval").clips.filter((c) => c.left + c.width <= NOW_X);
    assert.ok(past.length > 0);
    for (const c of past) assert.deepEqual([c.title, c.artist, c.bpm], [null, null, null]);
  });

  it("a song that begins too near the safe edge for a title carries none", () => {
    const before = scoreOf("before-start");
    const second = before.clips.find((c) => Math.abs(c.left - 89.44) < 0.01);
    assert.ok(second);
    assert.equal(second.title, null);
  });
});

describe("score rules", () => {
  it("'now' is dashed only while the clock guesses", () => {
    assert.equal(scoreOf("running").unsure, false);
    assert.equal(scoreOf("running", { unsure: true }).unsure, true);
  });

  it("an ambiguous recording says which occurrence the clip is, and drops the artist", () => {
    const s = scoreOf("running", { ambiguity: { songIndex: 5, ordinal: 1, total: 2 } });
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
    const input: ScoreInput = { classMs: at, lengthMs: at + 600_000, intervals: [mk(-10, 10), mk(0, 6), mk(6, 90), mk(250, 90)], songs: doc.songs, zoneName: () => "n", ambiguity: null, unsure: false };
    const s = layoutScore(input);
    // 6 s is 1.67 vw: too narrow for a number, so it is history, not a colour.
    assert.equal(s.thin.length, 1);
    assert.ok(s.thin[0].width < MIN_BLOCK_W);
    // The 250 s interval begins at 94 vw: no room for its number inside the safe area.
    assert.ok(xAt(at + 250_000, at) > NUMBER_FITS_UNTIL);
    assert.deepEqual(s.blocks.map((b) => b.left), [xAt(at + 6000, at)].map((v) => Math.round(v * 100) / 100));
  });

  it("the End mark appears when the end of the class is on the score, inside the safe area", () => {
    assert.equal(scoreOf("last-interval").endLeft, 66.67);
    assert.equal(scoreOf("finished").endLeft, 25);
    assert.equal(scoreOf("running").endLeft, null);
  });

  it("the strip moves 0.28 vw a second, in whole-second steps with reduced motion", () => {
    assert.ok(Math.abs(scoreShiftVw(1000, false) - 0.2778) < 0.001);
    assert.equal(scoreShiftVw(1500, true), scoreShiftVw(1000, true));
    assert.equal(scoreShiftVw(999, true), 0);
    assert.equal(scoreShiftVw(-5, false), 0);
  });
});
