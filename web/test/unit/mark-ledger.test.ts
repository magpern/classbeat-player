// One ledger for the whole room window (issue #606): the screen's own marks (fixed frames, ticks, actions) and the
// marks the shell asks for through `RoomScreen.requestMark` for its own changes (the band, the sheet, a plate) are
// placed by the same scheduler call, so together they keep the invariant: any two marks at least 500 ms apart (a
// frame shared by two draws is one mark), at most 2 in any second, and an outside change at most 500 ms late (1 s when
// it joins the interval's change frame or the count's switch beat; a frame or two on top for the clock's own step).
// Played on the real adapter and gate on clocks off the frame grid, with outside requests at random times.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTimeline } from "../../src/fixtures/timeline.ts";
import type { Scenario } from "../../src/fixtures/timeline.ts";
import { toRoomModel } from "../../src/room/adapter.ts";
import { FRAME_MS, createMarkGate } from "../../src/room/mark-gate.ts";
import type { MarkContext } from "../../src/room/mark-gate.ts";

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** The display frame a draw at `ms` is shown in (a draw within a few microseconds of a frame belongs to it). */
const grid = (ms: number): number => Math.ceil(ms / FRAME_MS - 1e-3) * FRAME_MS;

interface Request {
  readonly at: number;
  /** When it was drawn; null if never. */
  drawn: number | null;
  /** The interval's change frame or the switch beat was within 1 s of the request. */
  readonly fixedNear: boolean;
}
interface Sim {
  /** The real times of every draw, the screen's own and the outside ones. */
  readonly draws: number[];
  readonly requests: Request[];
}

function simulate(s: Scenario, seconds: number, asks: readonly number[], offset: number, jitter: number, late: number, seed: number): Sim {
  const tl = createTimeline(s);
  const gate = createMarkGate();
  const random = rng(seed);
  const draws: number[] = [];
  const requests: Request[] = [];
  let now = 0;
  const flush = (t: number): void => {
    now = t;
    if (gate.due(t)) draws.push(t);
    for (const run of gate.dueOutside(t)) run();
  };
  const todo = [...asks].sort((a, b) => a - b);
  let last = -1;
  for (let k = 0; k * FRAME_MS <= seconds * 1000; k += 1) {
    const t = Math.max(last + 0.01, k * FRAME_MS + (k === 0 ? 0 : offset + random() * jitter));
    last = t;
    const wake = gate.wakeAtMs();
    if (wake !== null && wake + late < t) flush(wake + late);
    const m = toRoomModel(tl.inputAt(t));
    const ctx: MarkContext = { changeAtMs: m.changeInMs === null ? null : t + m.changeInMs, switchAtMs: m.changeInMs === null || m.count === null ? null : t + m.count.beatsLeft * m.count.beatMs };
    now = t;
    if (gate.offer(m, t, ctx) && k > 0) draws.push(t);
    flush(t); // as `mount` does after every snapshot: what is due draws with it
    while (todo.length > 0 && todo[0] <= t) {
      todo.shift();
      const near = (ctx.changeAtMs !== null && ctx.changeAtMs - t < 1000) || (ctx.switchAtMs !== null && ctx.switchAtMs - t < 1000);
      const req: Request = { at: t, drawn: null, fixedNear: near };
      requests.push(req);
      gate.request(t, () => {
        req.drawn = now;
        draws.push(now);
          });
      flush(t);
    }
  }
  return { draws, requests };
}
/** Draws that share a frame are one mark: the real time of its first draw. */
function marksOf(draws: readonly number[]): number[] {
  const marks: number[] = [];
  for (const d of [...draws].sort((a, b) => a - b)) if (marks.length === 0 || (d > grid(marks[marks.length - 1]) + 1e-6 && d - marks[marks.length - 1] > 0.05)) marks.push(d);
  return marks;
}

describe("one ledger: the screen's marks and the shell's outside changes", () => {
  it("any two marks at least 500 ms apart, at most 2 in any second, outside changes at most 500 ms late (1 s in a change frame), on random timelines", () => {
    const random = rng(606);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)];
    for (let n = 0; n < 120; n += 1) {
      const events: Scenario["events"][number][] = [];
      for (let e = 0; e < 2; e += 1) events.push({ atMs: Math.floor(random() * 11_000), do: pick(["pause", "resume"] as const) });
      const s: Scenario = { fixture: pick(["running", "pattern", "coasting", "pattern-tempo-only"]), startMs: 1_169_000 - Math.floor(random() * 12_000), bpm: pick([undefined, 60, 95, 120, 128, 180, 200]), tinyAtMs: random() < 0.2 ? 1_169_000 : undefined, events };
      const asks = Array.from({ length: Math.floor(random() * 14) }, () => 300 + Math.floor(random() * 11_000));
      // Some clocks sit on the frame grid, some do not; a late timer.
      const sim = simulate(s, 13, asks, n % 2 === 0 ? 0 : random() * FRAME_MS, n % 2 === 0 ? 0 : random() * 5, random() * 3, n + 1);
      const label = JSON.stringify({ s, asks, n, draws: sim.draws.map((d) => Math.round(d * 10) / 10) });
      const marks = marksOf(sim.draws);
      for (let i = 1; i < marks.length; i += 1) assert.ok(marks[i] - marks[i - 1] >= 500 - 1e-6, `${label}: marks ${marks[i - 1].toFixed(1)} and ${marks[i].toFixed(1)} are ${(marks[i] - marks[i - 1]).toFixed(1)} ms apart`);
      for (const m of marks) assert.ok(marks.filter((x) => x >= m && x < m + 1000 - 1e-6).length <= 2, `${label}: more than 2 marks in the second from ${m.toFixed(1)}`);
      for (const r of sim.requests) {
        assert.ok(r.drawn !== null, `${label}: the change asked for at ${r.at.toFixed(1)} was never drawn`);
        const late = r.drawn - r.at;
        assert.ok(late <= (r.fixedNear ? 1000 : 500) + 2 * FRAME_MS + 4, `${label}: the change asked for at ${r.at.toFixed(1)} was drawn ${late.toFixed(0)} ms late`);
      }
    }
  });

  it("the example of the issue: a count at 120 bpm, a band shown at 250 and hidden at 750 keep 500 ms from every tick", () => {
    const s: Scenario = { fixture: "pattern", startMs: 1_099_000, bpm: 120, events: [] };
    const sim = simulate(s, 6, [2250, 2750], 0, 0, 0, 1);
    const marks = marksOf(sim.draws);
    for (let i = 1; i < marks.length; i += 1) assert.ok(marks[i] - marks[i - 1] >= 500 - 1e-6);
    for (const r of sim.requests) assert.ok(r.drawn !== null && r.drawn - r.at <= 500 + FRAME_MS + 2, `drawn ${r.drawn}`);
    // The tick that would have come within 500 ms of a band mark gave way: no 3 marks in 1 s anywhere.
    for (const m of marks) assert.ok(marks.filter((x) => x >= m && x < m + 1000 - 1e-6).length <= 2);
  });

  it("an outside change that is not wanted any more gives its mark up", () => {
    const gate = createMarkGate();
    let ran = 0;
    const ticket = gate.request(1000, () => (ran += 1));
    assert.ok(ticket.atMs >= 1000);
    ticket.cancel();
    assert.equal(gate.wakeAtMs(), null);
    assert.deepEqual(gate.dueOutside(5000), []);
    assert.equal(ran, 0);
  });

  it("two outside changes in one frame share it: one mark", () => {
    const gate = createMarkGate();
    const [a, b] = [gate.request(1001, () => undefined), gate.request(1005, () => undefined)];
    assert.equal(grid(a.atMs), grid(b.atMs));
  });
});
