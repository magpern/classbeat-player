import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_GAP_MS, PHASE_TOLERANCE_MS, lastLightStart, nextSchedule } from "../../src/room/beat-schedule.ts";
import type { BeatSchedule } from "../../src/room/beat-schedule.ts";
import type { BeatModel } from "../../src/room/model.ts";

const beat = (periodMs: number, phaseMs: number, key = "k"): BeatModel => ({ periodMs, phaseMs, key });

/** The phase a snapshot says at `now` for beats that fall on `grid + k * period`. */
const phaseOn = (grid: number, period: number, now: number): number => period - (((now - grid) % period) + period) % period;

describe("beat schedule", () => {
  it("keeps its lights while the key is the same and the phase agrees within the tolerance", () => {
    const a = nextSchedule(null, null, beat(468.75, 100), 1000);
    assert.equal(a.anchorMs, 1100);
    // Jitter below the tolerance (60 ms) does not move it, either way.
    assert.equal(nextSchedule(a, null, beat(468.75, 100 + PHASE_TOLERANCE_MS - 1), 1000), a);
    assert.equal(nextSchedule(a, null, beat(468.75, 100 - PHASE_TOLERANCE_MS + 1), 1000), a);
    assert.equal(nextSchedule(a, null, beat(468.75, 100), 1000 + 468.75 * 3), a, "a later snapshot on the same grid");
  });

  it("re-phases when the phase is off by more than the tolerance, never closer than 1/3 s to the last light", () => {
    const a = nextSchedule(null, null, beat(500, 100), 1000); // lights at 1100, 1600, ...
    const b = nextSchedule(a, null, beat(500, 100 - 150), 1250 + 0); // the snapshot says the next beat is at 1200: 150 ms early... but 1100 just started
    assert.notEqual(b, a);
    assert.ok(b.anchorMs - 1100 >= MIN_GAP_MS - 1e-9, `${b.anchorMs - 1100} ms after the last light`);
  });

  it("a new key never lights within 1/3 s of the last light", () => {
    const a = nextSchedule(null, null, beat(469, 100), 1000); // lights at 1100, 1569, ...
    const b = nextSchedule(a, null, beat(500, 60, "other"), 1200); // would light at 1260, 160 ms after 1100
    assert.ok(b.anchorMs - 1100 >= MIN_GAP_MS - 1e-9, `${b.anchorMs - 1100} ms`);
  });

  it("the last light that started is known, and none before the first", () => {
    const s: BeatSchedule = { key: "k", periodMs: 500, anchorMs: 1000 };
    assert.equal(lastLightStart(s, 800), null);
    assert.equal(lastLightStart(s, 1730), 1500);
  });

  it("stays on the beat over several minutes: no drift at 128 or 132 bpm", () => {
    for (const bpm of [128, 132]) {
      const period = 60_000 / bpm; // 468.75 and 454.5454...: exact, not rounded
      const grid = 777; // where the song's beats fall, in ms
      let schedule: BeatSchedule | null = null;
      let last: number | null = null;
      for (let t = 0; t <= 300_000; t += 1000) {
        if (schedule) last = lastLightStart(schedule, t) ?? last;
        schedule = nextSchedule(schedule, last, beat(period, phaseOn(grid, period, t)), t);
        if (t >= 240_000) {
          // 4 minutes in, a light is still within the tolerance of a true beat.
          const light = lastLightStart(schedule, t) ?? 0;
          const off = Math.abs((((light - grid) % period) + period) % period);
          assert.ok(Math.min(off, period - off) <= PHASE_TOLERANCE_MS, `${bpm} bpm drifted ${off.toFixed(0)} ms at ${t / 1000} s`);
        }
      }
    }
  });

  it("follows a seek inside the song: the lights move to the new beat grid", () => {
    const period = 60_000 / 128;
    let schedule: BeatSchedule | null = null;
    let last: number | null = null;
    const gridBefore = 100;
    const gridAfter = 100 + period / 2 + 37; // the song was seeked: beats now fall elsewhere
    for (let t = 0; t <= 20_000; t += 500) {
      if (schedule) last = lastLightStart(schedule, t) ?? last;
      const grid = t < 10_000 ? gridBefore : gridAfter;
      schedule = nextSchedule(schedule, last, beat(period, phaseOn(grid, period, t)), t);
    }
    const light = lastLightStart(schedule as BeatSchedule, 20_000) ?? 0;
    const off = (((light - gridAfter) % period) + period) % period;
    assert.ok(Math.min(off, period - off) <= PHASE_TOLERANCE_MS, `still ${off.toFixed(0)} ms off the new grid`);
  });

  it("with snapshot jitter above the tolerance and tempo changes near 180 bpm, no two lights start less than 1/3 s apart", () => {
    let schedule: BeatSchedule | null = null;
    let last: number | null = null;
    const starts: number[] = [];
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
    for (let t = 0; t < 30_000; t += 250) {
      const bpm = t < 10_000 ? 176 : t < 20_000 ? 184 : 178;
      const period = 60_000 / bpm >= 1000 / 3 ? 60_000 / bpm : (60_000 / bpm) * 2;
      const phase = Math.min(period, Math.max(0, period / 2 + rnd() * 150));
      const before = schedule;
      if (before) last = lastLightStart(before, t) ?? last;
      schedule = nextSchedule(before, last, beat(period, phase, `s:${bpm}`), t);
      const s = schedule;
      let first = s.anchorMs >= t ? s.anchorMs : s.anchorMs + Math.ceil((t - s.anchorMs) / s.periodMs) * s.periodMs;
      for (; first < t + 250; first += s.periodMs) starts.push(first);
    }
    assert.ok(starts.length > 20);
    for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] - starts[i - 1] >= MIN_GAP_MS - 1e-6, `lights ${starts[i - 1]} and ${starts[i]} are ${starts[i] - starts[i - 1]} ms apart`);
  });
});
