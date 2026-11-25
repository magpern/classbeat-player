// What the running screen says (scene.md S4, S12, S14, "Fitting"): all nine content items in every
// running state at every layout, hue only on what stands for a zone, the pattern folding where it
// has no room, and the link states in their words. Fake classes only.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LinkInput } from "../../model/src/index.ts";
import { LONG_TEXT, WORST_TEXT, longSongIndexAt } from "../demo/long-class.ts";
import { cueSmall, foldsPattern, layoutFor, nameSmall, nextCueLines, patternRoom } from "../src/text-fit-calc.ts";
import type { TextInput } from "../src/text-types.ts";
import { textView } from "../src/text-view-calc.ts";
import { barsText, clockText, countdownText, specForms } from "../src/text-words.ts";

const input = (classMs: number, link: LinkInput = { state: "Locked" }, aspect = 16 / 9, cls = LONG_TEXT): TextInput => {
  const songIndex = longSongIndexAt(classMs);
  return { cls, classMs, songIndex, songPosMs: classMs - (cls.songs.at(songIndex)?.startMs ?? 0), link, reducedMotion: false, aspect };
};
const LINKS: LinkInput[] = [{ state: "Locked" }, { state: "Paused" }, { state: "Coasting" }, { state: "Off the list" }, { state: "Ambiguous" }, { state: "Manual" }, { state: "Locked", held: true }];

test("S4: all nine content items are in the view in every running state, at every layout", () => {
  for (const link of LINKS) for (const aspect of [16 / 9, 1.6, 4 / 3, 5 / 4]) for (const t of [30, 200, 355, 575, 645, 800, 950]) {
    const v = textView(input(t * 1000, link, aspect));
    const where = `${link.state}${link.held ? " held" : ""} at ${aspect} and ${t} s`;
    assert.match(v.clock.count, /^\d+:\d\d$/, `${where}: 1 time left in the interval`);
    assert.ok(v.clock.label.length > 0, where);
    assert.ok(v.gel.numeral.length > 0 && v.gel.name.length > 0 && v.gel.targets.length > 0, `${where}: 2 the zone, with its targets`);
    assert.deepEqual(v.metrics.map((m) => m.key), ["cadence", "position", "song"], `${where}: 3 and 4 cadence, position, tempo`);
    assert.ok(v.metrics.every((m) => m.value.length > 0), where);
    assert.ok(v.cue.text.length > 0, `${where}: 5 the cue`);
    assert.ok(v.next.zoneName.length > 0 && (v.next.end || v.next.length.length > 0), `${where}: 6 what comes next`);
    assert.ok(v.score.intervals.length > 0 && v.score.songs.length > 0, `${where}: 7 the score`);
    assert.ok(v.rail.left?.endsWith("left") && v.rail.done?.endsWith("done"), `${where}: 8 the time in the class`);
    assert.ok(v.rail.link.text.length > 0, `${where}: 9 the music-link state`);
  }
});

test("S12: the view holds no colour at all, only zone numbers: hue is the zone's and the layer takes it from tokens.css", () => {
  const v = textView(input(355_000));
  assert.doesNotMatch(JSON.stringify(v), /#[0-9a-f]{3,8}\b|rgb|hsl|color/i);
  assert.equal(v.gel.zone, 4);
  assert.equal(v.next.zone, 5);
});

test("the link states have their words, and only a fault is a white plate", () => {
  const words = (link: LinkInput) => { const p = textView(input(355_000, link)).rail.link; return [p.text, p.alert]; };
  assert.deepEqual(words({ state: "Locked" }), ["Following Spotify", false]);
  assert.deepEqual(words({ state: "Paused" }), ["Music paused", true]);
  assert.deepEqual(words({ state: "Coasting" }), ["Music not heard", true]);
  assert.deepEqual(words({ state: "Off the list" }), ["Not a class song", true]);
  assert.deepEqual(words({ state: "Ambiguous" }), ["Song is in twice", true]);
  assert.deepEqual(words({ state: "Manual" }), ["Manual clock", false]);
  assert.equal(textView(input(355_000, { state: "Paused" })).rail.segment, null, "the segment name is hidden while a plate shows");
  assert.equal(textView(input(355_000, { state: "Locked" }, 4 / 3)).rail.segment, null, "and dropped at 3:2 and narrower");
  assert.equal(textView(input(355_000)).rail.segment, "Main set");
});

test("paused, coasting and off the list: the clock says what it knows", () => {
  const paused = textView(input(355_000, { state: "Paused" }));
  assert.deepEqual([paused.clock.paused, paused.clock.bars, paused.clock.pauseLine, paused.gel.look], [true, null, "Starts again with the music", "down"]);
  const coasting = textView(input(355_000, { state: "Coasting" }));
  assert.deepEqual([coasting.clock.label, coasting.clock.estimated, coasting.clock.bars], ["Interval left, estimated", true, null]);
  const off = textView(input(355_000, { state: "Off the list" }));
  assert.equal(off.metrics.at(2)?.label, "Song, planned");
  const locked = textView(input(355_000));
  assert.match(locked.clock.bars ?? "", /^\d+ bars to the change$/);
  assert.equal(textView(input(355_000, { state: "Locked", held: true })).clock.label, "Until the next song");
  assert.equal(textView(input(446_000)).clock.label, "Change in", "the last 5 seconds");
  const lastOnBeat = { ...LONG_TEXT, intervals: LONG_TEXT.intervals.slice(0, 4) }; // the zone 4 interval is the last, in a song with beat anchors
  const last = textView(input(400_000, { state: "Locked" }, 16 / 9, lastOnBeat));
  assert.equal(last.clock.label, "Last interval");
  assert.match(last.clock.bars ?? "", /to the end$/);
  assert.deepEqual([last.next.end, last.next.zoneName], [true, "End of class"]);
});

test("S14: the pattern block at 16:9, the pattern folded into the Position metric at 3:2 and narrower, and a note when there is no count", () => {
  const wide = textView(input(335_000));
  assert.equal(wide.pattern?.label, "8 up, 8 down");
  assert.equal(wide.pattern?.state.kind, "count");
  assert.equal(wide.metrics.at(1)?.value, "Up / down");
  assert.equal(wide.metrics.at(1)?.folded, null);
  const narrow = textView(input(335_000, { state: "Locked" }, 4 / 3));
  assert.equal(narrow.pattern, null);
  assert.equal(narrow.metrics.at(1)?.folded?.kind, "count", "side and count in the Position value");
  const none = textView(input(335_000, { state: "Coasting" }));
  assert.deepEqual(none.pattern?.state, { kind: "note", text: "Count from the music" });
  assert.equal(none.pattern?.squares, null);
  const squares = textView(input(335_000)).pattern?.squares;
  assert.ok(squares && squares.total === 8 && squares.left >= 1 && squares.left <= 8, "one square per beat of this side, filled for the beats left");
  assert.equal(textView(input(300_000)).pattern, null, "an interval with no pattern has no block");
});

test("fitting: a pattern with less than 16 vw folds, a long zone name steps down, a long cue steps down, the next cue yields to a long cue", () => {
  assert.equal(foldsPattern({ aspect: 16 / 9, countGlyphs: 4, valueGlyphs: 5, unitGlyphs: 3 }), false);
  assert.equal(foldsPattern({ aspect: 1.6, countGlyphs: 5, valueGlyphs: 7, unitGlyphs: 3 }), true, "five glyphs next to '100-110 rpm' at 16:10");
  assert.ok(patternRoom({ aspect: 16 / 9, countGlyphs: 4, valueGlyphs: 5, unitGlyphs: 3 }) > patternRoom({ aspect: 16 / 9, countGlyphs: 5, valueGlyphs: 5, unitGlyphs: 3 }));
  assert.equal(nameSmall("Threshold", "wide", 16 / 9), false);
  assert.equal(nameSmall("Neuromuscular", "wide", 1.6), true, "a word wider than the line");
  assert.equal(nameSmall("Neuromuscular Power", "narrow", 4 / 3), true);
  assert.equal(cueSmall("x".repeat(60)), false);
  assert.equal(cueSmall("x".repeat(61)), true);
  const long = "w".repeat(120).replace(/(.{7})/g, "$1 ");
  const [short, tall] = [nextCueLines({ layout: "wide", aspect: 16 / 9, currentCue: "Short.", nextCue: long, lineVh: 4.6 }), nextCueLines({ layout: "wide", aspect: 16 / 9, currentCue: long, nextCue: long, lineVh: 4.6 })];
  assert.ok(short >= 2 && tall < short, `a three-line cue leaves the next cue ${tall} lines, a short one ${short}`);
  const worst = textView(input(355_000, { state: "Locked" }, 16 / 9, WORST_TEXT));
  assert.deepEqual([worst.cue.small, worst.clock.wide, worst.gel.nameSmall, worst.metrics.at(0)?.value], [true, true, true, "100–110"]);
  assert.equal(layoutFor(1.5), "narrow");
  assert.equal(layoutFor(1.51), "wide");
});

test("reduced motion: the pattern count still steps with the beat (it is information); only the score steps once a second", () => {
  const at = (ms: number, reducedMotion: boolean) => textView({ ...input(ms), reducedMotion });
  const beat = 60_000 / 128;
  const [a, b] = [at(335_000, true), at(335_000 + beat, true)];
  assert.equal(a.reduced, true);
  assert.notDeepEqual(a.pattern?.state, b.pattern?.state, "the count stepped by one beat");
  assert.deepEqual(at(335_100, true).score, at(335_900, true).score, "the score holds within the second");
  assert.notDeepEqual(at(335_100, false).score, at(335_900, false).score);
});

test("words: clocks, bars, the next row's spec forms (longest first, the unit then the cadence dropped)", () => {
  assert.equal(clockText(70_000), "1:10");
  assert.equal(countdownText(10 * 60_000 + 50_000), "10:50");
  assert.equal(countdownText(100 * 60_000), "99+");
  assert.equal(barsText(1, false), "1 bar to the change");
  assert.deepEqual(specForms({ from: 85, to: 95 }, "seated", null), ["85–95 rpm Seated", "85–95 Seated", "Seated"]);
  assert.deepEqual(specForms("beat", null, { positions: ["standing", "seated"], beats: [4, 4], startOn: "interval_start" }), ["On the beat 4 up, 4 down", "4 up, 4 down"]);
});
