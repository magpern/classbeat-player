// The switch beat the screen announces (`CountModel.switchInMs`) falls where the player's own count switches: on the song's beat grid
// (player/app/src/core/clock/pattern.ts), not on the interval's start. Checked against the real `patternAt` of the player's clock.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { patternAt } from "../../../player/app/src/core/clock/pattern.ts";
import { planFrom } from "../../../player/app/src/core/clock/plan.ts";
import { FIXTURES } from "../../src/fixtures/index.ts";
import { clockAt, linkAt } from "../../src/fixtures/build.ts";
import type { Class, RoomInput } from "../../src/room/input.ts";
import { toRoomModel } from "../../src/room/adapter.ts";

const base = FIXTURES.pattern.doc as Class;
const INDEX = 6;
type Anchors = { at_ms: number; bpm: number }[] | undefined;

/** The class with the song's tempo and anchors replaced, and the pattern's start. */
function docWith(bpm: number, anchors: Anchors, startOn: "interval_start" | "next_downbeat"): Class {
  const iv = base.intervals[INDEX];
  const songs = base.songs.map((s) => (s.start_ms <= iv.start_ms && iv.start_ms < s.end_ms ? { ...s, bpm, beat_anchors: anchors ? { quality: "measured" as const, anchors } : undefined } : s)) as Class["songs"];
  const intervals = base.intervals.map((x, i) => (i === INDEX ? { ...x, pattern: { ...x.pattern!, start_on: startOn } } : x)) as Class["intervals"];
  return { ...base, songs, intervals };
}

/** The player's switch time after `t`: the first class time (to the ms) at which its step changes. */
function realSwitch(doc: Class, t: number): number {
  const plan = planFrom(doc);
  const step = patternAt(plan, t)?.stepIndex;
  for (let u = t + 1; u < t + 30_000; u += 1) if (patternAt(plan, u)?.stepIndex !== step) return u;
  throw new Error("no switch");
}

function announced(doc: Class, t: number): number | null {
  const p = patternAt(planFrom(doc), t);
  assert.ok(p?.counted && p.beat !== null && p.beatsLeft !== null && p.nextPosition);
  const view = clockAt(doc, t);
  const input: RoomInput = { doc, view, link: linkAt(view, "Locked"), pattern: { position: p.position, beat: p.beat, beatsLeft: p.beatsLeft, nextPosition: p.nextPosition } };
  const m = toRoomModel(input);
  return m.count?.switchInMs === undefined ? null : t + m.count.switchInMs;
}

describe("the switch beat is on the song's grid, as in the player's count", () => {
  const cases: [string, number, Anchors, "interval_start" | "next_downbeat"][] = [
    ["tempo only, interval start", 126, undefined, "interval_start"],
    ["tempo only, 128 bpm", 128, undefined, "interval_start"],
    ["anchors at another tempo", 126, [{ at_ms: 400, bpm: 124 }], "interval_start"],
    ["next downbeat, with anchors", 128, [{ at_ms: 300, bpm: 128 }], "next_downbeat"],
  ];
  for (const [name, bpm, anchors, startOn] of cases) {
    it(name, () => {
      const doc = docWith(bpm, anchors, startOn);
      const iv = doc.intervals[INDEX];
      // The interval's start is off the song's grid, so a count taken from the interval start would differ (the old rule).
      const song = doc.songs.find((s) => s.start_ms <= iv.start_ms && iv.start_ms < s.end_ms)!;
      const off = (((iv.start_ms - song.start_ms) * bpm) / 60_000) % 1;
      assert.ok(off > 0.05 && off < 0.95, `the interval starts off a beat (${off})`);
      let checked = 0;
      for (let t = iv.start_ms + 1500; t < iv.start_ms + iv.length_ms - 20_000 && checked < 40; t += 337) {
        const got = announced(doc, t);
        if (got === null) continue;
        checked += 1;
        const want = realSwitch(doc, t);
        assert.ok(Math.abs(got - want) <= 1.5, `at ${t}: the player switches at ${want}, the screen says ${got}`);
      }
      assert.ok(checked > 10, `checked ${checked}`);
    });
  }
});
