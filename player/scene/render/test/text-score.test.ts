// The score (scene.md S3 look-ahead, S13 intervals first, "The score"): what is drawn ahead of
// "now", which labels a block carries, and the rule that a zone colour never shows without its
// number. Fake classes only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LONG_TEXT } from "../demo/long-class.ts";
import { NOW_X, aheadMinutes, msAtBeat, scoreClock, scoreView } from "../src/text-score-calc.ts";
import type { TextClass, TextInterval } from "../src/text-types.ts";

const S = 1000;
const WIDE = 16 / 9;
const input = (cls: TextClass, classMs: number, aspect: number, reducedMotion = false) => ({ cls, classMs, songIndex: 0, songPosMs: classMs, link: { state: "Locked" } as const, reducedMotion, aspect });
const iv = (startS: number, lengthS: number, zone = 3): TextInterval => ({ startMs: startS * S, lengthMs: lengthS * S, zone, name: "Tempo", cue: "Hold it", cadence: null, position: "seated", pattern: null });
const cls = (intervals: TextInterval[], songLengthS = 1200): TextClass => ({
  ...LONG_TEXT, intervals, endMs: songLengthS * S, songs: [{ title: "One", artist: "A", startMs: 0, lengthMs: songLengthS * S, bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }] }],
});
const blocks = (c: TextClass, classMs: number, aspect: number) => scoreView(input(c, classMs, aspect), aspect <= 1.5).intervals;

test("the window is 8 minutes ahead wider than 3:2 and 6 minutes at 3:2 and narrower, to the screen's right edge", () => {
  assert.deepEqual([aheadMinutes(false), aheadMinutes(true)], [8, 6]);
  const a = cls([iv(0, 300), iv(300, 600)]);
  const wide = scoreView(input(a, 0, WIDE), false);
  assert.ok(Math.abs((wide.intervals.at(1)?.x0 ?? 0) - (NOW_X + (90 * 300) / 480)) < 1e-9, "the second block starts 5 minutes ahead at 11.25 vw a minute");
  const narrow = scoreView(input(a, 0, 4 / 3), true);
  assert.ok(Math.abs((narrow.intervals.at(1)?.x0 ?? 0) - (NOW_X + (90 * 300) / 360)) < 1e-9, "at 15 vw a minute narrower");
});

test("S3: every interval of 40 s or more starting within the labelled window shows its number and its length, at every supported ratio", () => {
  for (const aspect of [WIDE, 1.6, 1.5, 4 / 3, 5 / 4]) {
    const narrow = aspect <= 1.5;
    const labelled = narrow ? 5 : 7; // minutes
    for (const length of [40, 41, 90, 300]) {
      const c = cls([iv(0, 60), iv(labelled * 60 - 1, length, 5), iv(labelled * 60 + 59, 600, 6)]);
      const b = blocks(c, 0, aspect).find((x) => x.zone === 5);
      assert.ok(b !== undefined && b.kind === "zone", `aspect ${aspect}, ${length} s: the block is drawn`);
      assert.equal(b?.number, "5", `aspect ${aspect}, ${length} s: number`);
      assert.equal(b?.length, length >= 60 ? `${Math.floor(length / 60)}:${String(length % 60).padStart(2, "0")}` : `0:${length}`, `aspect ${aspect}, ${length} s: length`);
    }
  }
});

test("the zone colour never shows without its number: a block too narrow for it is neutral, one cut by the right edge is not drawn", () => {
  const c = cls([iv(0, 60), iv(60, 12, 4), iv(72, 30, 5), iv(110, 300, 6), iv(7 * 60 + 40, 60, 7), iv(8 * 60 + 10, 60, 2)]);
  for (const aspect of [WIDE, 4 / 3]) {
    for (let t = 0; t < 600; t += 3) {
      for (const b of scoreView(input(c, t * S, aspect), aspect <= 1.5).intervals) {
        if (b.kind === "zone") assert.notEqual(b.number, null, `aspect ${aspect}, ${t} s, zone ${b.zone}: a zone colour with no number`);
        else assert.equal(b.number, null);
        if (b.kind === "zone") assert.ok(b.x1 - b.x0 >= 2.5, "a block under 2.5 vw is never drawn in its zone colour");
        if (b.kind !== "past") assert.ok(b.x0 < 91, "a block that the right edge cuts to under 9 vw is not drawn at all");
      }
    }
  }
  const sliver = blocks(cls([iv(0, 60), iv(60, 5, 4)]), 0, WIDE).find((b) => b.zone === 4);
  assert.equal(sliver?.kind, "neutral");
});

test("S13: three intervals inside one song are three blocks, each with its number, in the look-ahead window; the song clip merges nothing", () => {
  const c = cls([iv(0, 60, 2), iv(60, 90, 3), iv(150, 90, 4), iv(240, 90, 5)], 600);
  const view = scoreView(input(c, 0, WIDE), false);
  assert.deepEqual(view.intervals.map((b) => b.number), ["2", "3", "4", "5"]);
  assert.equal(view.songs.length, 1, "one song clip underneath");
  assert.ok(view.intervals.every((b) => b.length !== null), "number and length on each");
  assert.ok(view.intervals.slice(1).every((b) => b.name !== null), "and the name where it fits");
});

test("blocks wholly in the past are grey with nothing on them, and the current block keeps its labels just right of now", () => {
  const c = cls([iv(0, 60, 2), iv(60, 300, 3)]);
  const [past, current] = blocks(c, 80 * S, WIDE);
  assert.equal(past?.kind, "past");
  assert.deepEqual([past?.number, past?.length, past?.name, past?.detail], [null, null, null, null]);
  assert.equal(current?.kind, "zone");
  assert.ok((current?.textLeft ?? 0) >= NOW_X, "labels start right of the fixed now line");
});

test("a block with a pattern starts its second line with the pattern in words and carries the beat strip where the grid is known", () => {
  const withPattern: TextInterval = { ...iv(0, 120, 4), pattern: { positions: ["standing", "seated"], beats: [8, 8], startOn: "interval_start" } };
  const b = blocks(cls([withPattern]), 0, WIDE).at(0);
  assert.match(b?.detail ?? "", /^8 up, 8 down · Hold it/);
  assert.ok(b?.strip && b.strip.parts.length === 2 && b.strip.parts.at(0)?.up === true && b.strip.parts.at(1)?.up === false);
  assert.ok(Math.abs((b?.strip?.cycleVw ?? 0) - (16 * 0.5 * 90) / 480) < 1e-9, "one cycle of 16 beats at 120 bpm on the score's scale");
  const noTempo = { ...cls([withPattern]), songs: [{ title: "x", artist: "y", startMs: 0, lengthMs: 600 * S }] };
  assert.equal(blocks(noTempo, 0, WIDE).at(0)?.strip, null, "no strip without a bpm");
  const downbeat: TextInterval = { ...withPattern, pattern: { positions: ["standing", "seated"], beats: [8, 8], startOn: "next_downbeat" } };
  assert.equal(blocks({ ...noTempo, intervals: [downbeat] }, 0, WIDE).at(0)?.strip, null);
  assert.ok(blocks(cls([downbeat]), 0, WIDE).at(0)?.strip, "with anchors a next_downbeat pattern has its grid");
});

test("reduced motion: the score steps once a second instead of gliding", () => {
  const c = cls([iv(0, 300), iv(300, 300)]);
  assert.equal(scoreClock(355_900, true), 355_000);
  assert.deepEqual(scoreView(input(c, 100_900, WIDE, true), false), scoreView(input(c, 100_100, WIDE, true), false));
  assert.notDeepEqual(scoreView(input(c, 100_900, WIDE), false), scoreView(input(c, 100_100, WIDE), false));
});

test("song clips carry their moments and phrase ticks only where the song has beat anchors; msAtBeat inverts the model's beat count", () => {
  const view = scoreView({ ...input(LONG_TEXT, 330 * S, WIDE), songIndex: 1, songPosMs: 90 * S }, false);
  const clip = view.songs.find((s) => s.title === "Aurora Lane");
  assert.ok(clip && clip.ticks.length > 3, "phrase ticks every 4 bars");
  assert.deepEqual(clip?.moments.map((m) => m.word), ["Drop"]);
  const glass = scoreView({ ...input(LONG_TEXT, 700 * S, WIDE), songIndex: 2, songPosMs: 220 * S }, false).songs.find((s) => s.title === "Glass Rooms");
  assert.deepEqual(glass?.ticks, [], "a song with no beat anchors has no phrase ticks");
  assert.equal(msAtBeat([{ at_ms: 1000, bpm: 120 }], 4), 3000);
  assert.equal(msAtBeat([{ at_ms: 0, bpm: 60 }, { at_ms: 10_000, bpm: 120 }], 12), 11_000);
});
