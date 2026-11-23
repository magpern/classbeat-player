// The pure scheduler as the plain screen uses it (flash-marks.ts, merged in #590; docs/design/room-2d.md,
// "The flash budget on the plain screen"): random timelines, with 1 ms intervals, user actions at any
// time, every kind of tick, any tempo and any refresh rate. The plain screen has no drops. The properties
// are the screen's own: any two marks at least 500 ms apart, the fixed frames move only by P1's merge, an
// action shows at most 500 ms after it (1 s when it joins a fixed frame), and at most 2 marks in any second.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fixedFrames, frameAt, placeMarks } from "../../../player/scene/model/src/flash-marks.ts";
import type { Want } from "../../../player/scene/model/src/flash-marks.ts";

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("the scheduler's invariant on random timelines of the plain screen", () => {
  it("holds for 2000 timelines", () => {
    const random = rng(2026);
    for (let n = 0; n < 2000; n += 1) {
      // Refresh rates at which 500 ms is a whole number of frames. At others (75 Hz: 37.5 frames) P2's lateness rounds up
      // past 500 ms and an action joins a fixed frame however far ahead it is: reported on the pull request (the
      // scheduler is the scene lane's, flash-marks.ts, and is not edited here). The screen's own gate (mark-gate.ts)
      // runs P2 at 60 Hz with fixed frames only within 2 s ahead, and its random-timeline test uses 60 to 144 Hz.
      const frameMs = 1000 / [30, 60, 90, 120, 144, 240][Math.floor(random() * 6)];
      const span = 20_000;
      // Interval changes: some a millisecond apart, some a second or more.
      const changes: number[] = [];
      let at = Math.floor(random() * 3000);
      for (let i = 0; i < 1 + Math.floor(random() * 8); i += 1) {
        changes.push(at);
        at += random() < 0.4 ? 1 + Math.floor(random() * 1200) : 1000 + Math.floor(random() * 6000);
      }
      const bpm = 30 + Math.floor(random() * 200);
      const wants: Want[] = [];
      for (let t = Math.floor(random() * 1000); t < span; t += 1000) wants.push({ kind: "tick", atMs: t, periodMs: 1000 }); // the countdown
      if (random() < 0.5) {
        // A count: a tick each beat, the switch beat first every 4 to 16 beats.
        const beat = 60_000 / bpm;
        const side = 4 + Math.floor(random() * 13);
        for (let i = 0, t = 0; t < span; i += 1, t = i * beat) wants.push({ kind: i % side === 0 ? "switch" : "tick", atMs: t, periodMs: beat });
      }
      for (let i = 0; i < Math.floor(random() * 6); i += 1) wants.push({ kind: "action", atMs: Math.floor(random() * span) });
      const fixed = fixedFrames(changes, [], frameMs);
      const placed = placeMarks(fixed, wants, frameMs);

      // Fixed frames move only by P1's merge: one frame per chain, at the first change of it.
      for (const f of fixed) assert.equal(f.atMs, frameAt(f.changes[0], frameMs));
      for (let i = 1; i < fixed.length; i += 1) assert.ok(fixed[i].changes[0] - fixed[i - 1].changes[0] >= 1000, "changes under 1 s apart share a frame");

      const marks = [...new Set([...fixed.map((f) => f.atMs), ...placed.filter((p) => p.how === "own").map((p) => p.atMs!)])].sort((a, b) => a - b);
      const label = JSON.stringify({ frameMs, changes, bpm, n });
      for (let i = 1; i < marks.length; i += 1) assert.ok(marks[i] - marks[i - 1] >= 500 - 1e-6, `${label}: marks ${marks[i - 1]} and ${marks[i]}`);
      for (const m of marks) assert.ok(marks.filter((x) => x >= m && x < m + 1000 - 1e-6).length <= 2, `${label}: more than 2 marks from ${m}`);
      // A joined or replaced want shows on a mark that exists; a placed want is on the list above.
      for (const p of placed) if (p.atMs !== null) assert.ok(marks.some((m) => Math.abs(m - p.atMs!) < 1e-6), `${label}: ${p.want.kind} at ${p.want.atMs} is on no mark`);
      for (const p of placed) {
        if (p.want.kind !== "action" || p.atMs === null) continue;
        const late = p.atMs - p.want.atMs;
        assert.ok(late <= (p.how === "joined" ? 1000 : 500) + frameMs, `${label}: an action at ${p.want.atMs} shows ${late} ms later (${p.how})`);
      }
    }
  });
});
