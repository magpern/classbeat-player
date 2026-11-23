// One ledger for the whole room window (issue #606): the screen's own marks (fixed frames, ticks, actions) and the
// marks the shell asks for through `RoomScreen.requestMark` for its own changes (the band, the sheet, a plate) are
// placed by the same scheduler call, so together they keep the invariant: any two marks at least 500 ms apart (draws
// in one flush are one mark), at most 2 in any second, an outside change at most 500 ms late (C10, plus the one or two
// frames of the clock's own step), or 1 s when it joins the interval's change frame or the count's switch beat, and a
// fixed frame never later than it is with no outside change at all (P1). Played on the real adapter and gate on clocks
// off the frame grid, with outside requests at random times, over many seeds.
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
/**
 * A fixed frame is drawn no later than with no outside change, but for a tick that was placed 500 ms before it by the clock's own
 * step and drawn up to a snapshot late: the defect this guards against (an outside draw on the frame holding it back by 500 ms) is far over.
 */
const LATE_FIXED_MS = 150;
/** What the clock's own step and the frame a draw lands in add to a bound. */
const TOLERANCE = 2 * FRAME_MS + 4;

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
  /** When each interval was first drawn by the screen. */
  readonly keyDrawn: Map<string, number>;
  /** Who drew when, for the message of a failure. */
  readonly trace: string[];
}

function simulate(s: Scenario, seconds: number, asks: readonly number[], offset: number, jitter: number, late: number, seed: number): Sim {
  const tl = createTimeline(s);
  const gate = createMarkGate();
  const random = rng(seed);
  const draws: number[] = [];
  const requests: Request[] = [];
  const keyDrawn = new Map<string, number>();
  const trace: string[] = [];
  let now = 0;
  let latestKey = "";
  const flush = (t: number): void => {
    now = t;
    if (gate.due(t)) {
      draws.push(t);
      trace.push(`screen@${t.toFixed(1)}`);
      if (!keyDrawn.has(latestKey)) keyDrawn.set(latestKey, t);
    }
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
    latestKey = m.intervalKey;
    const ctx: MarkContext = { changeAtMs: m.changeInMs === null ? null : t + m.changeInMs, switchAtMs: m.changeInMs === null || m.count === null ? null : t + (m.count.switchInMs ?? 0) };
    now = t;
    if (gate.offer(m, t, ctx)) {
      if (k > 0) draws.push(t);
      trace.push(`offer@${t.toFixed(1)}`);
      if (!keyDrawn.has(m.intervalKey)) keyDrawn.set(m.intervalKey, t);
    }
    flush(t); // as `mount` does after every snapshot: what is due draws with it
    // The shell's own timer fires a moment later, in a task of its own.
    for (const at = t + 0.01; todo.length > 0 && todo[0] <= t; ) {
      todo.shift();
      const near = (ctx.changeAtMs !== null && ctx.changeAtMs - at < 1000 + FRAME_MS) || (ctx.switchAtMs !== null && ctx.switchAtMs - at < 1000 + FRAME_MS);
      const req: Request = { at, drawn: null, fixedNear: near };
      requests.push(req);
      const ticket = gate.request(at, () => {
        req.drawn = now;
        draws.push(now);
        trace.push(`out(${at.toFixed(0)})@${now.toFixed(1)}`);
      });
      trace.push(`ask(${at.toFixed(0)})->${ticket.atMs.toFixed(0)}`);
      flush(at);
    }
  }
  return { draws, requests, keyDrawn, trace };
}

/** Draws made in one flush (within 50 microseconds) are one mark: the real time of its first draw. */
function marksOf(draws: readonly number[]): number[] {
  const marks: number[] = [];
  for (const d of [...draws].sort((a, b) => a - b)) if (marks.length === 0 || d - marks[marks.length - 1] > 0.05) marks.push(d);
  return marks;
}

function checkRun(label: string, sim: Sim, base: Sim | null): void {
  const marks = marksOf(sim.draws);
  for (let i = 1; i < marks.length; i += 1) assert.ok(marks[i] - marks[i - 1] >= 500 - 1e-6, `${label}: marks ${marks[i - 1].toFixed(1)} and ${marks[i].toFixed(1)} are ${(marks[i] - marks[i - 1]).toFixed(1)} ms apart`);
  for (const m of marks) assert.ok(marks.filter((x) => x >= m && x < m + 1000 - 1e-6).length <= 2, `${label}: more than 2 marks in the second from ${m.toFixed(1)}`);
  for (const r of sim.requests) {
    assert.ok(r.drawn !== null, `${label}: the change asked for at ${r.at.toFixed(1)} was never drawn`);
    const late = r.drawn - r.at;
    assert.ok(late <= (r.fixedNear ? 1000 : 500) + TOLERANCE, `${label}: the change asked for at ${r.at.toFixed(1)} was drawn ${late.toFixed(0)} ms late${r.fixedNear ? " (a fixed frame is near)" : ""}`);
  }
  // P1: a fixed frame never moves. Where the run has no pause, an interval is drawn no later than with no outside change at all
  // (the ticks placed 500 ms before it by the clock's own step may hold it back by LATE_FIXED_MS, never by the 500 ms of an outside draw).
  for (const [key, at] of base?.keyDrawn ?? []) {
    const was = sim.keyDrawn.get(key);
    assert.ok(was !== undefined && was <= at + LATE_FIXED_MS, `${label}: interval ${key} is drawn at ${was} instead of ${at.toFixed(1)}`);
  }
}

/** A seed from the date, printed, so that every run looks at something new and a failure can be replayed. */
const TODAY = Number(new Date().toISOString().slice(0, 10).replaceAll("-", "")) % 100_000;
const SEEDS = process.env.SEED_ONLY ? [Number(process.env.SEED_ONLY)] : [...Array.from({ length: 24 }, (_, i) => 606 + i * 7919), 119391 /* a pause took the fixed frame a change was riding: marks 300 ms apart (review of #609, B5) */, TODAY];

describe("one ledger: the screen's marks and the shell's outside changes", () => {
  it(`any two marks at least 500 ms apart, at most 2 in any second, outside changes at most 500 ms late (1 s in a change frame), a fixed frame on time; ${SEEDS.length} seeds of 120 timelines (the date's seed is ${TODAY})`, () => {
    for (const seed of SEEDS) {
      const random = rng(seed);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)];
      for (let n = 0; n < 120; n += 1) {
        const events: Scenario["events"][number][] = [];
        // Without a pause or resume (a user action that makes a new fixed frame after a mark is placed), the fixed frames are known from the start.
        // (A pause or seek stops the fixed frames a change was riding: it is then drawn at the frame's wait bound, which the bound test below covers.)
        for (let e = 0; e < (random() < 0.5 ? 0 : 2); e += 1) events.push({ atMs: Math.floor(random() * 11_000), do: pick(["pause", "resume"] as const) });
        const s: Scenario = { fixture: pick(["running", "pattern", "coasting", "pattern-tempo-only"]), startMs: 1_169_000 - Math.floor(random() * 12_000), bpm: pick([undefined, 60, 95, 120, 128, 180, 200]), tinyAtMs: random() < 0.2 ? 1_169_000 : undefined, events };
        const asks = Array.from({ length: Math.floor(random() * 14) }, () => 300 + Math.floor(random() * 11_000));
        // Some clocks sit on the frame grid, some do not; a late timer.
        const [offset, jitter, late] = n % 2 === 0 ? [0, 0, random() * 3] : [random() * FRAME_MS, random() * 5, random() * 3];
        if (process.env.N_ONLY && n !== Number(process.env.N_ONLY)) continue;
        const sim = simulate(s, 13, asks, offset, jitter, late, n + 1);
        const base = events.length === 0 ? simulate(s, 13, [], offset, jitter, late, n + 1) : null;
        checkRun(JSON.stringify({ seed, n, s, asks, offset, jitter, late, trace: sim.trace.join(' '), base: base?.trace.join(' ') }), sim, base);
      }
    }
  });

  it("the example of the issue: a count at 120 bpm, a band shown at 250 and hidden at 750 keep 500 ms from every tick", () => {
    const s: Scenario = { fixture: "pattern", startMs: 1_099_000, bpm: 120, events: [] };
    const sim = simulate(s, 6, [2250, 2750], 0, 0, 0, 1);
    checkRun("example", sim, simulate(s, 6, [], 0, 0, 0, 1));
  });

  it("a change asked for just before the interval's change frame is drawn with it, and the interval is drawn on time (P1), at any snapshot cadence", () => {
    for (const every of [1, 6, 15]) {
      for (const before of [300, 150, 40]) {
        const run = (ask: number | null): { key: number | null; out: number | null } => {
          const tl = createTimeline({ fixture: "running", startMs: 1_160_000, events: [] });
          const gate = createMarkGate();
          let [key, out, first, changeAt, asked] = [null as number | null, null as number | null, "", null as number | null, false];
          let now = 0;
          const flush = (t: number): void => {
            now = t;
            const m = gate.due(t);
            if (m && key === null && m.intervalKey !== first) key = t;
            for (const r of gate.dueOutside(t)) r();
          };
          for (let k = 0; k * FRAME_MS < 12_000; k += 1) {
            const t = k * FRAME_MS;
            const w = gate.wakeAtMs();
            if (w !== null && w <= t) flush(w);
            // The shell's own timer fires between snapshots.
            if (ask !== null && !asked && changeAt !== null && t >= changeAt - ask) {
              asked = true;
              gate.request(t + 0.01, () => (out = now));
              flush(t + 0.01);
            }
            if (k % every !== 0) continue;
            const m = toRoomModel(tl.inputAt(t));
            first ||= m.intervalKey;
            if (changeAt === null && m.changeInMs !== null) changeAt = t + m.changeInMs;
            const drawn = gate.offer(m, t, { changeAtMs: m.changeInMs === null ? null : t + m.changeInMs, switchAtMs: null });
            if (drawn && key === null && drawn.intervalKey !== first) key = t;
            flush(t);
          }
          return { key, out };
        };
        const [without, withAsk] = [run(null), run(before)];
        assert.ok(withAsk.key !== null && without.key !== null && withAsk.key <= without.key + TOLERANCE, `every ${every} frames, asked ${before} ms before: the interval is drawn at ${withAsk.key}, not ${without.key}`);
        assert.ok(withAsk.out !== null && withAsk.key !== null && Math.abs(withAsk.out - withAsk.key) < 0.05, `every ${every}, asked ${before} ms before: the outside change is drawn at ${withAsk.out}, the change frame at ${withAsk.key}`);
      }
    }
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

  it("cancel works until the draw: one change of a batch gives up another that is due in the same frame", () => {
    const gate = createMarkGate();
    const ran: string[] = [];
    let second: ReturnType<typeof gate.request> | null = null;
    gate.request(1001, () => {
      ran.push("first");
      second?.cancel();
    });
    second = gate.request(1005, () => ran.push("second"));
    for (const run of gate.dueOutside(5000)) run();
    assert.deepEqual(ran, ["first"]);
  });

  it("two outside changes in one frame share it: one mark", () => {
    const gate = createMarkGate();
    const [a, b] = [gate.request(1001, () => undefined), gate.request(1005, () => undefined)];
    assert.equal(grid(a.atMs), grid(b.atMs));
  });

  it("a ticket reports the frame it is planned in now: a real draw that came late moves the next one, and atMs follows", () => {
    const tl = createTimeline({ fixture: "running", startMs: 1_099_000, events: [] });
    const gate = createMarkGate();
    assert.ok(gate.offer(toRoomModel(tl.inputAt(0)), 0, { changeAtMs: null, switchAtMs: null }));
    const first = gate.request(520, () => undefined);
    const second = gate.request(700, () => undefined);
    const [was, planned] = [first.atMs, second.atMs];
    assert.ok(planned >= was + 500 - 1, `${planned} is 500 ms after ${was}`);
    // The first is drawn 40 ms after its frame: the second is under 500 ms behind it now and gives way to the real gap.
    const late = was + 40;
    for (const run of gate.dueOutside(late)) run();
    assert.ok(second.atMs >= late + 500 - 1 && second.atMs > planned, `still reports ${second.atMs}, planned ${planned}`);
    const ran: number[] = [];
    for (const run of gate.dueOutside(second.atMs)) {
      ran.push(1);
      run();
    }
    assert.deepEqual(ran, [1], "it is drawn where atMs said");
  });

  it("a change that joined a fixed frame waits for that frame's snapshot at most 100 ms past it", () => {
    const tl = createTimeline({ fixture: "running", startMs: 1_099_000, events: [] });
    const gate = createMarkGate();
    assert.ok(gate.offer(toRoomModel(tl.inputAt(0)), 0, { changeAtMs: null, switchAtMs: null }));
    // An action 100 ms on, with a change frame 450 ms after the first mark: 500 ms after the mark would be 50 ms from the frame, so it joins the frame.
    const action = toRoomModel(createTimeline({ fixture: "running", startMs: 1_099_000, events: [{ atMs: 50, do: "link", state: "Coasting" }] }).inputAt(100));
    assert.equal(gate.offer(action, 100, { changeAtMs: 450, switchAtMs: null }), null);
    const wake = gate.wakeAtMs();
    assert.ok(wake !== null && Math.abs(wake - 550) <= FRAME_MS, `waits until ${wake}, the frame (450) and 100 ms`);
    assert.ok(gate.due(wake), "and shows itself when that snapshot never came");
  });
});
