// The frame marks of the plain screen (docs/design/room-2d.md, "The flash budget on the plain screen"):
// every change shows on a mark, any two marks at least 500 ms apart, so at most two in any second. Run
// on the real adapter and gate, a class played on a clock stepped by frames with a snapshot at every
// frame (the harshest cadence): recorded timelines and random ones (any tempo, an action at any time).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTimeline } from "../../src/fixtures/timeline.ts";
import type { Scenario } from "../../src/fixtures/timeline.ts";
import { toRoomModel } from "../../src/room/adapter.ts";
import { changeKind } from "../../src/room/change-kind.ts";
import { FRAME_MS, createMarkGate } from "../../src/room/mark-gate.ts";

interface Run {
  /** The frame times (ms) at which the screen changed, after the first draw. */
  readonly marks: number[];
  readonly shown: Map<number, ReturnType<typeof toRoomModel>>;
  /** The longest time an action (or a timed or outside change) waited on screen to show. */
  readonly waited: number;
}

/** What `mountRoom` does with each snapshot, without a page: model, gate, and the gate's wake-up at each frame. */
function play(s: Scenario, seconds: number, frameMs = FRAME_MS): Run {
  const tl = createTimeline(s);
  const gate = createMarkGate(frameMs);
  const marks: number[] = [];
  const shown = new Map<number, ReturnType<typeof toRoomModel>>();
  let [current, since, waited] = [null as ReturnType<typeof toRoomModel> | null, null as number | null, 0];
  for (let k = 0; k * frameMs <= seconds * 1000; k += 1) {
    const t = k * frameMs;
    let drawn = gate.due(t);
    const m = toRoomModel(tl.inputAt(t));
    const ctx = { changeAtMs: m.changeInMs === null ? null : t + m.changeInMs, switchAtMs: m.changeInMs === null || m.count === null ? null : t + m.count.beatsLeft * m.count.beatMs };
    drawn = gate.offer(m, t, ctx) ?? drawn;
    if (drawn) {
      if (k > 0) marks.push(t);
      shown.set(t, drawn);
      current = drawn;
    }
    if (current && changeKind(current, m) === "action") {
      since ??= t;
      waited = Math.max(waited, t - since);
    } else since = null;
  }
  return { marks, shown, waited };
}

const gapsOk = (marks: readonly number[]): void => {
  for (let i = 1; i < marks.length; i += 1) assert.ok(marks[i] - marks[i - 1] >= 500 - 1e-6, `marks ${marks[i - 1].toFixed(1)} and ${marks[i].toFixed(1)} ms are ${(marks[i] - marks[i - 1]).toFixed(1)} ms apart`);
  for (const m of marks) assert.ok(marks.filter((x) => x >= m && x < m + 1000 - 1e-6).length <= 2, `more than 2 marks in the second from ${m.toFixed(1)} ms`);
};

const LEFT = 1_160_000; // 9 s before the Threshold interval ends at 1:19:29 of the 42-minute class
const PATTERN_AT = 1_099_000;

describe("frame marks, played on the real adapter", () => {
  it("a running class steps once a second, on the countdown's tick", () => {
    const r = play({ fixture: "running", startMs: PATTERN_AT, events: [] }, 8);
    gapsOk(r.marks);
    assert.ok(r.marks.length >= 6 && r.marks.length <= 8, `${r.marks.length} marks in 8 s`);
  });

  it("the interval change is one frame at its time, with everything that changes in it", () => {
    const r = play({ fixture: "running", startMs: LEFT, events: [] }, 12);
    const change = r.marks.find((t) => r.shown.get(t)?.intervalKey === "running:7");
    assert.ok(change !== undefined && Math.abs(change - 9000) <= FRAME_MS + 1, `the change is at ${change} ms, not 9000`);
    const m = r.shown.get(change)!;
    assert.equal(m.gel?.numeral, "2");
    assert.equal(m.rail.done, "19:29", "the class time is its true value in that frame");
    assert.equal(m.clock?.count, "0:45");
    gapsOk(r.marks);
  });

  it("a count running steps on its ticks, at least 500 ms apart, at any tempo, the countdown with it", () => {
    for (const bpm of [50, 90, 120, 128, 180, 200]) {
      const r = play({ fixture: "pattern", startMs: PATTERN_AT, bpm, events: [] }, 20);
      gapsOk(r.marks);
      const counts = r.marks.map((t) => r.shown.get(t)?.metrics[1]?.value);
      assert.ok(new Set(counts).size > 2, `bpm ${bpm}: the count never stepped: ${counts.join(",")}`);
      // Every beat up to 120 bpm; above it the cap (2 a second) gives the count's cadence way.
      const expected = (20 * Math.min(bpm, 120)) / 60;
      assert.ok(r.marks.length >= expected * 0.8 && r.marks.length <= 40, `bpm ${bpm}: ${r.marks.length} marks, about ${expected} expected`);
    }
  });

  it("the beat dot is gone and the count shows the beats left: UP 8 to UP 1, then DOWN 8", () => {
    const r = play({ fixture: "pattern", startMs: PATTERN_AT, bpm: 60, events: [] }, 20);
    const counts = r.marks.map((t) => r.shown.get(t)?.metrics[1]?.value);
    // One step a beat at 60 bpm (a count tick each second): the side runs down to 1, then the other side from 8.
    assert.deepEqual(counts.slice(0, 8), ["UP 3", "UP 2", "UP 1", "DOWN 8", "DOWN 7", "DOWN 6", "DOWN 5", "DOWN 4"]);
    assert.ok(r.shown.get(r.marks[0])?.count !== null);
  });

  it("an action shows within 500 ms (1 s when it joins a change frame); a pause and a resume 600 ms apart are two marks", () => {
    const r = play({ fixture: "running", startMs: PATTERN_AT, events: [{ atMs: 2300, do: "pause" }, { atMs: 2900, do: "resume" }, { atMs: 3100, do: "pause" }] }, 8);
    gapsOk(r.marks);
    for (const at of [2300, 2900, 3100]) {
      const first = r.marks.find((t) => t >= at - 1e-6);
      assert.ok(first !== undefined && first - at <= 500 + FRAME_MS, `the action at ${at} ms shows at ${first}`);
    }
  });

  it("a seek across a change, a jump and a start are one mark each", () => {
    const r = play({ fixture: "running", startMs: PATTERN_AT, events: [{ atMs: 1000, do: "seek", toMs: 1_168_800 }, { atMs: 1700, do: "seek", toMs: 1_020_000 }] }, 5);
    gapsOk(r.marks);
    const start = play({ fixture: "before-start", events: [{ atMs: 1200, do: "start" }] }, 4);
    gapsOk(start.marks);
    assert.equal(start.shown.get(start.marks[0])?.kind, "running");
  });

  it("intervals 0.3 s and 0.4 s apart are one change frame: the latest shows, the merged-away ones never", () => {
    const tiny = 1_079_000 + 20_000;
    const r = play({ fixture: "running", startMs: tiny - 3000, tinyAtMs: tiny, events: [] }, 6);
    gapsOk(r.marks);
    const zones = new Set(r.marks.map((t) => r.shown.get(t)?.gel?.numeral));
    assert.ok(!zones.has("5") && !zones.has("6"), `a merged-away interval showed: ${[...zones].join(",")}`);
  });
});

describe("frame marks, random timelines (any tempo, any refresh rate, an action at any time)", () => {
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it("any two marks are at least 500 ms apart, at most two in any second, and an action shows within 500 ms (1 s joined)", () => {
    const random = rng(583);
    const fixtures = ["running", "pattern", "coasting", "paused", "manual", "off-list", "before-start", "finished", "pattern-tempo-only"];
    for (let n = 0; n < 60; n += 1) {
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)];
      const fixture = pick(fixtures);
      const frameMs = 1000 / pick([60, 90, 120, 144]);
      const events: Scenario["events"][number][] = [];
      for (let e = 0; e < 4; e += 1) {
        const atMs = Math.floor(random() * 11_000);
        const kind = pick(["pause", "resume", "seek", "start", "link"] as const);
        events.push(kind === "seek" ? { atMs, do: "seek", toMs: 1_000_000 + Math.floor(random() * 200_000) } : kind === "link" ? { atMs, do: "link", state: pick(["Locked", "Coasting", "Off the list"] as const) } : { atMs, do: kind });
      }
      const s: Scenario = { fixture, startMs: 1_169_000 - Math.floor(random() * 12_000), bpm: pick([undefined, 60, 95, 128, 160, 200]), tinyAtMs: random() < 0.3 ? 1_169_000 : undefined, events };
      const r = play(s, 12, frameMs);
      gapsOk(r.marks);
      // An action shows within 500 ms; 1 s when it joins a change frame (the gate waits 250 ms more for that frame's snapshot).
      assert.ok(r.waited <= 1000 + 250 + frameMs, `${JSON.stringify(s)}: an action waited ${r.waited.toFixed(0)} ms`);
    }
  });
});
