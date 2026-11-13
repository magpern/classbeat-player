import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_GAP_MS, lastLightStart, nextSchedule } from "../../src/room/beat-schedule.ts";
import type { BeatSchedule } from "../../src/room/beat-schedule.ts";
import type { BeatModel } from "../../src/room/model.ts";

const beat = (periodMs: number, phaseMs: number, key = "k"): BeatModel => ({ periodMs, phaseMs, key });

describe("beat schedule", () => {
  it("keeps its lights while the key is the same, whatever phase the next snapshot says", () => {
    const a = nextSchedule(null, null, beat(469, 100), 1000);
    assert.equal(a.anchorMs, 1100);
    assert.equal(nextSchedule(a, null, beat(469, 7), 1250), a);
  });

  it("a new key never lights within 1/3 s of the last light", () => {
    const a = nextSchedule(null, null, beat(469, 100), 1000); // lights at 1100, 1569, ...
    const b = nextSchedule(a, null, beat(500, 60, "other"), 1200); // would light at 1260, 160 ms after 1100
    assert.ok(b.anchorMs - 1100 >= MIN_GAP_MS, `${b.anchorMs - 1100} ms`);
    assert.equal(b.anchorMs, 1100 + MIN_GAP_MS);
  });

  it("the last light that started is known, and none before the first", () => {
    const s: BeatSchedule = { key: "k", periodMs: 500, anchorMs: 1000 };
    assert.equal(lastLightStart(s, 800), null);
    assert.equal(lastLightStart(s, 1730), 1500);
  });

  it("with snapshot jitter and an anchor change near 180 bpm, no two lights start less than 1/3 s apart", () => {
    // Snapshots every 250 ms for 30 s; the phase each says is off by up to 150 ms either way, and
    // the tempo in force changes at 10 s and 20 s (a new key each time).
    let schedule: BeatSchedule | null = null;
    let last: number | null = null;
    const starts: number[] = [];
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
    for (let t = 0; t < 30_000; t += 250) {
      const bpm = t < 10_000 ? 176 : t < 20_000 ? 184 : 178;
      const period = 60_000 / bpm >= 1000 / 3 ? 60_000 / bpm : (60_000 / bpm) * 2;
      const key = `s:${bpm}`;
      const beatModel = beat(Math.ceil(period), Math.max(0, Math.round(Math.ceil(period) / 2 + rnd() * 150)), key);
      const before = schedule;
      if (before) last = lastLightStart(before, t) ?? last;
      schedule = nextSchedule(before, last, beatModel, t);
      // The lights that start before the next snapshot.
      const s = schedule;
      let first = s.anchorMs >= t ? s.anchorMs : s.anchorMs + Math.ceil((t - s.anchorMs) / s.periodMs) * s.periodMs;
      for (; first < t + 250; first += s.periodMs) starts.push(first);
    }
    assert.ok(starts.length > 20);
    for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] - starts[i - 1] >= MIN_GAP_MS, `lights ${starts[i - 1]} and ${starts[i]} are ${starts[i] - starts[i - 1]} ms apart`);
  });
});
