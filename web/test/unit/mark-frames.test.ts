// The fixed-frame rules of the mark gate (mark-frames.ts) and what the gate does with a change whose fixed frame has gone (a pause or a
// seek took it away): it is seated again off the fixed frames and the marks that are left, never early by a rule that does not look (N8, N9).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { frameAt } from "../../../player/scene/model/src/flash-marks.ts";
import { createTimeline } from "../../src/fixtures/timeline.ts";
import { toRoomModel } from "../../src/room/adapter.ts";
import { FRAME_MS, createMarkGate } from "../../src/room/mark-gate.ts";
import { earliestAway, switchFrame } from "../../src/room/mark-frames.ts";

const grid = (ms: number): number => frameAt(ms, FRAME_MS);
const fixed = (...ts: number[]) => ts.map((atMs) => ({ atMs, change: true, changes: [atMs], drops: [] }));

describe("the count's switch beat as a fixed frame", () => {
  it("is not one of its own within 500 ms of the change frame, before it or after it", () => {
    assert.equal(switchFrame({ changeAtMs: 8000, switchAtMs: 7700 }), null);
    assert.equal(switchFrame({ changeAtMs: 8000, switchAtMs: 8300 }), null, "a beat just after the change frame (a 1-beat step at a high tempo)");
    assert.equal(switchFrame({ changeAtMs: 8000, switchAtMs: 8000 }), null);
  });
  it("is one when it is 500 ms or more from the change frame, or there is none", () => {
    assert.equal(switchFrame({ changeAtMs: 8000, switchAtMs: 7500 }), 7500);
    assert.equal(switchFrame({ changeAtMs: 8000, switchAtMs: 8500 }), 8500);
    assert.equal(switchFrame({ changeAtMs: null, switchAtMs: 8100 }), 8100);
    assert.equal(switchFrame({ changeAtMs: 8000, switchAtMs: null }), null);
  });
});

describe("earliestAway keeps off fixed frames and marks", () => {
  it("moves past a mark, rides a fixed frame ahead, and passes one behind", () => {
    assert.deepEqual(earliestAway([], [1000], 1200, grid), { at: grid(1500), rides: null });
    assert.deepEqual(earliestAway(fixed(1600), [], 1200, grid), { at: 1600, rides: 1600 });
    const behind = earliestAway(fixed(1000), [], 1200, grid);
    assert.ok(behind.rides === null && behind.at >= 1500 - 1, `${behind.at}`);
    // A mark the move off a frame lands near is passed too (one in the very frame would be shared).
    const both = earliestAway(fixed(1000), [1550], 1200, grid);
    assert.ok(both.rides === null && both.at >= 2050 - 20, `${both.at}`);
  });
});

describe("a change whose fixed frame is gone", () => {
  const start = () => {
    const tl = createTimeline({ fixture: "running", startMs: 1_099_000, events: [] });
    const gate = createMarkGate();
    const first = toRoomModel(tl.inputAt(0));
    assert.ok(gate.offer(first, 0, { changeAtMs: null, switchAtMs: null }));
    // The same model offered again: nothing changes on the screen, so the screen draws nothing of its own and only the fixed frames move.
    const model = (): typeof first => first;
    return { gate, model };
  };

  it("is seated again, early, when nothing stands in the way", () => {
    const { gate, model } = start();
    gate.offer(model(), 900, { changeAtMs: null, switchAtMs: 1500 });
    const ticket = gate.request(1100.01, () => undefined);
    assert.ok(ticket.atMs >= 1600 - 1, `it rides the switch beat: ${ticket.atMs}`);
    gate.offer(model(), 1200, { changeAtMs: null, switchAtMs: null });
    assert.ok(ticket.atMs <= 1200 + FRAME_MS, `the beat is gone, and nothing is near: ${ticket.atMs}`);
  });

  it("rides the fixed frame that is now near instead of landing 400 ms before it", () => {
    const { gate, model } = start();
    gate.offer(model(), 900, { changeAtMs: null, switchAtMs: 1500 });
    const ticket = gate.request(1100.01, () => undefined);
    // The beat is gone; the interval's change frame is at 1600, 400 ms after the earliest place (1200).
    gate.offer(model(), 1200, { changeAtMs: 1600, switchAtMs: null });
    assert.ok(ticket.atMs >= 1600 - 1, `drawn at ${ticket.atMs}, ahead of the change frame (P1)`);
    assert.ok(ticket.atMs <= 1600 + 100 + FRAME_MS, `and no later than its wait bound: ${ticket.atMs}`);
  });

  it("a change asked for while another is reserved a moment ahead shares its mark, and a beat that follows leaves both alone", () => {
    const { gate, model } = start();
    const other = gate.request(150, () => undefined); // reserved at 500
    gate.offer(model(), 180, { changeAtMs: null, switchAtMs: 700 });
    const second = gate.request(200.01, () => undefined);
    assert.ok(Math.abs(second.atMs - other.atMs) < 1e-6, `${second.atMs} and ${other.atMs}: one mark`);
    gate.offer(model(), 250, { changeAtMs: null, switchAtMs: null });
    assert.ok(Math.abs(second.atMs - other.atMs) < 1e-6, "still one mark when the beat is gone");
  });
});

describe("the gate's guards that keep P2 and P1 when the world moves under a placed mark", () => {
  const tl = createTimeline({ fixture: "running", startMs: 1_099_000, events: [] });
  const first = toRoomModel(tl.inputAt(0));
  /** A model one countdown second on: the screen's own change, a tick. */
  const ticked = toRoomModel(tl.inputAt(1100));
  const none = { changeAtMs: null, switchAtMs: null };

  it("an outside draw under 500 ms before the screen's pending mark pushes it to 500 ms after the draw (a late timer)", () => {
    const gate = createMarkGate();
    assert.ok(gate.offer(first, 0, none));
    gate.request(100, () => undefined); // reserved at 500
    assert.equal(gate.offer(ticked, 695, none), null);
    // The timer is late: the outside change is drawn at 700, 16 ms before the tick's frame.
    for (const run of gate.dueOutside(700)) run();
    assert.equal(gate.due(1150), null, "the tick gives way: no mark within 500 ms of the draw at 700");
    assert.ok(gate.due(700 + 500 + FRAME_MS), "and shows 500 ms after it");
  });

  it("a mark whose place is already past is not drawn 400 ms before a change frame that has come into view since", () => {
    const gate = createMarkGate();
    assert.ok(gate.offer(first, 0, none));
    assert.equal(gate.offer(ticked, 100, none), null, "the tick is placed at 500");
    // At 600 the change frame at 1000 is known: the tick's place (500) is past, and it is drawn now or never, 400 ms before the frame.
    assert.equal(gate.offer(ticked, 600, { changeAtMs: 1000, switchAtMs: null }), null, "it rides the change frame instead");
    const wake = gate.wakeAtMs();
    assert.ok(wake !== null && wake >= 1000, `waits for the frame's snapshot: ${wake}`);
  });

  it("a stopped clock brings no snapshot of a frame that was coming: a change riding it is seated again at once", () => {
    const gate = createMarkGate();
    assert.ok(gate.offer(first, 0, none));
    gate.offer(first, 900, { changeAtMs: null, switchAtMs: 1500 });
    const ticket = gate.request(1100.01, () => undefined);
    assert.ok(ticket.atMs >= 1600 - 1, `it rides the beat: ${ticket.atMs}`);
    // The beat passes while the clock still runs: the frame is announced, and its snapshot is on its way.
    gate.offer(first, 1510, none);
    assert.ok(ticket.atMs >= 1600 - 1, `still waiting for it: ${ticket.atMs}`);
    // Then the clock stops: no snapshot comes.
    gate.offer({ ...first, moving: false }, 1520, none);
    assert.ok(ticket.atMs <= 1520 + FRAME_MS, `seated again now: ${ticket.atMs}`);
  });
});
