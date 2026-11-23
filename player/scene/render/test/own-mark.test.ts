// A mark the rig places for a held change (P2, src/mark-hold-calc.ts) is reported: to the text clock, so its own marks keep 500 ms from it,
// and in the loop's draw (`heldMark`), which the steady gate reads as a mark. With the report removed, each of these fails.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SceneClass } from "../../model/src/index.ts";
import { mergeIntervals } from "../../model/src/index.ts";
import { DEMO_CLASS } from "../demo/scenario.ts";
import type { Feed } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { FRAME_MS } from "../src/marks-calc.ts";
import { TextClock } from "../src/text-clock.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const DT = 1 / 60;

test("the text clock keeps its marks 500 ms from a mark the rig noted: a countdown second 300 ms after it moves later", () => {
  const cls = mergeIntervals(DEMO_CLASS);
  const steps = (note: boolean): number[] => {
    const clock = new TextClock();
    const out: number[] = [];
    for (let ms = 29_900; ms < 33_000; ms += FRAME_MS) {
      const shown = clock.step({ cls, classMs: ms, songIndex: 0, songPosMs: ms, link: { state: "Locked" }, reducedMotion: false });
      if (note && ms >= 30_100 && ms < 30_100 + FRAME_MS) clock.note(30_700);
      if (shown.changed && ms > 30_100 + FRAME_MS) out.push(ms);
    }
    return out;
  };
  const without = steps(false);
  const next = without.find((ms) => ms > 30_500)!;
  assert.ok(next >= 31_000 && next < 31_050, "the countdown second at 31 s");
  const noted = steps(true);
  assert.ok(noted.every((ms) => Math.abs(ms - 30_700) >= 500 - 1e-6), "no text step within 500 ms of the noted mark");
});

/** A class whose only interval counts at 50 bpm (a beat every 1.2 s) and whose breakdown ends 100 ms after a count beat: 1.1 s from the next mark. */
const SLOW: SceneClass = {
  songs: [{ bpm: 50, anchors: [{ at_ms: 0, bpm: 50 }], moments: [{ at_ms: 100, kind: "breakdown" }] }],
  intervals: [{ startMs: 0, zone: 3, pattern: { positions: ["standing", "seated"], beats: [8, 8], startOn: "interval_start" } }, { startMs: 60_000, zone: 2 }],
  endMs: 80_000,
};

test("the loop reports the mark it placed for a held change on the frame the change lands, and the change lands there and nowhere else", () => {
  const loop = new RigLoop(tokensFromFile());
  const feed = (ms: number): Feed => ({ cls: SLOW, classMs: ms, songIndex: 0, songPosMs: ms, link: { state: "Locked" }, reducedMotion: false });
  const seen: { ms: number; mark: number; lit: number }[] = [];
  const changes: number[] = [];
  let [ms, before] = [0, -1];
  for (let n = 0; ms < 45_000; n++) {
    const d = loop.step(feed(ms), n === 0 ? 0 : DT, "High");
    const lit = d.lit.filter(Boolean).length;
    if (d.heldMark !== null) seen.push({ ms, mark: d.heldMark, lit });
    if (before >= 0 && lit !== before) changes.push(ms);
    before = lit;
    ms += d.dtSeconds * 1000;
  }
  const end = 100 + 32 * 1200; // the breakdown's end, 38.5 s
  assert.equal(seen.filter((o) => o.mark > 30_000).length, 1, "one own mark around the breakdown's end");
  const own = seen.at(-1);
  assert.ok(own!.mark >= end && own!.mark - end < 1000, "within 1 s of the change");
  assert.ok(own!.ms >= own!.mark && own!.ms - own!.mark < FRAME_MS + 1, "on the frame of the mark");
  assert.ok(changes.some((c) => Math.abs(c - own!.ms) < 1), "the lit fixtures change on that frame");
  assert.equal(changes.filter((c) => c > end - 1 && c < end + 2000).length, 1, "and on no other frame around the breakdown's end");
});

test("through the loop the text keeps 500 ms from the mark the rig placed: a link change 100 ms after it steps the text later", () => {
  const loop = new RigLoop(tokensFromFile());
  const steps: number[] = [];
  let [ms, own] = [0, 0];
  for (let n = 0; ms < 41_000; n++) {
    const link = ms >= 39_000 ? ({ state: "Coasting" } as const) : ({ state: "Locked" } as const);
    const d = loop.step({ cls: SLOW, classMs: ms, songIndex: 0, songPosMs: ms, link, reducedMotion: false }, n === 0 ? 0 : DT, "High");
    if (d.heldMark !== null && d.heldMark > 30_000) own = d.heldMark;
    if (d.text.changed && ms > 38_500) steps.push(ms);
    ms += d.dtSeconds * 1000;
  }
  assert.ok(own > 38_500 && own < 39_000, "the rig's own mark, just before the link changes");
  assert.ok(steps.length > 0 && steps.every((s) => Math.abs(s - own) >= 500 - 1e-6), `a text step within 500 ms of the own mark at ${own}: ${steps.join(", ")}`);
});
