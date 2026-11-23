// P1 in the text layer (scene.md text rule 2): interval changes under 1 s apart are one change frame showing the latest; a
// merged-away interval is absent from the gel, the countdown and the next row, and the score keeps its block with no
// number and no colour.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_TEXT } from "../demo/demo-text.ts";
import { mergeTextClass } from "../src/text-merge-calc.ts";
import type { TextClass, TextInterval } from "../src/text-types.ts";
import { textView } from "../src/text-view-calc.ts";

const at = (startMs: number, lengthMs: number, zone: number): TextInterval => ({ ...DEMO_TEXT.intervals[0]!, startMs, lengthMs, zone, name: `Zone ${zone}`, cue: `cue ${zone}` });
/** The demo class with two extra intervals after the one at 20 s: 20.0 s (zone 2), 20.4 s (zone 3) and 20.7 s (zone 5), then 40 s (zone 4). */
const crowded: TextClass = {
  ...DEMO_TEXT,
  intervals: [DEMO_TEXT.intervals[0]!, at(20_000, 400, 2), at(20_400, 300, 3), at(20_700, 19_300, 5), at(40_000, 20_000, 4)],
};
const input = (cls: TextClass, classMs: number) => ({ cls, classMs, songIndex: 0, songPosMs: classMs, link: { state: "Locked" } as const, reducedMotion: false, aspect: 16 / 9 });

test("a class with no changes under 1 s apart is returned as it is", () => {
  assert.equal(mergeTextClass(DEMO_TEXT), DEMO_TEXT);
});

test("three changes within 0.7 s are one change frame at the first, showing the latest", () => {
  const merged = mergeTextClass(crowded);
  assert.deepEqual(merged.intervals.map((iv) => [iv.startMs, iv.zone]), [[0, 1], [20_000, 5], [40_000, 4]]);
  const view = textView(input(merged, 20_000));
  assert.equal(view.gel.numeral, "5", "the gel shows the latest at the first change's time");
  assert.equal(view.next.zone, 4, "the next row is the next one not merged away");
  assert.equal(view.clock.count, "0:20", "the countdown is of the merged interval, from 20 s to 40 s");
  assert.equal(view.cue.text, "cue 5");
});

test("the score keeps its own block for each merged-away interval, with no number and no colour", () => {
  const view = textView(input(mergeTextClass(crowded), 15_000));
  const blocks = view.score.intervals;
  const away = blocks.filter((b) => b.key === "i1" || b.key === "i2"); // the 20.0 s and 20.4 s intervals, merged away
  assert.ok(away.every((b) => b.kind === "neutral"), "neutral: no zone colour");
  assert.equal(away.length, 2, "the two merged away");
  assert.ok(away.every((b) => b.number === null && b.length === null && b.name === null && b.detail === null), "nothing in them");
  const own = blocks.filter((b) => b.kind === "zone").map((b) => b.number);
  assert.ok(own.includes("5") && own.includes("4") && !own.includes("2") && !own.includes("3"), `numbers in the score: ${own.join(" ")}`);
  assert.ok(away.every((b) => b.x1 - b.x0 > 0), "each as wide as its own length");
});

test("a merged-away interval's zone is nowhere in the text but the score", () => {
  const view = textView(input(mergeTextClass(crowded), 20_050));
  const words = JSON.stringify({ gel: view.gel, rail: view.rail, clock: view.clock, metrics: view.metrics, cue: view.cue, next: view.next });
  assert.ok(!words.includes("cue 2") && !words.includes("cue 3"), "no cue of a merged-away interval");
  assert.ok(!words.includes("Zone 2") && !words.includes("Zone 3"), "no name of one");
});
