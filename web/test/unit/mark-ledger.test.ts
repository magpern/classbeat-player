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
import { TOLERANCE, checkRun, grid, runSeed, simulate } from "./ledger-sim.ts";

/** A fixed sweep: the same seeds on every run, so CI never depends on the day. `SEEDS=a-b` runs another range, `CASES` sets the timelines per seed, `SEED_ONLY` one seed, `N_ONLY` one case of it. */
const [FROM, TO] = (process.env.SEEDS ?? "1-500").split("-").map(Number);
const CASES = Number(process.env.CASES ?? 16);
/** Seeds the reviews of #609 found failing (B5, B7, B8): all 120 timelines of each are played, for good. */
const PINNED = [874, 119391, 1256761, 1989864, 2094593, 1675677, 4189173, 1047303];
const only = process.env.N_ONLY ? Number(process.env.N_ONLY) : undefined;

describe("one ledger: the screen's marks and the shell's outside changes", () => {
  const sweep = (label: string, seeds: readonly number[], cases: number): void => {
    it(`${label}: any two marks at least 500 ms apart, at most 2 in any second, outside changes at most 500 ms late (1 s in a change frame), a fixed frame on time; ${seeds.length} seeds of ${cases} timelines`, () => {
      const failed: string[] = [];
      for (const seed of seeds) for (const f of runSeed(seed, only, cases)) failed.push(`seed ${seed} n ${f.n}: ${f.error.slice(-200)}`);
      assert.equal(failed.length, 0, `${failed.length} failing cases, the first ones:\n${failed.slice(0, 5).join("\n")}`);
    });
  };
  if (process.env.SEED_ONLY) sweep("one seed", [Number(process.env.SEED_ONLY)], 120);
  else {
    sweep("pinned seeds", PINNED, 120);
    sweep("fixed sweep", Array.from({ length: TO - FROM + 1 }, (_, i) => FROM + i), CASES);
  }

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
