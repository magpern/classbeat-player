// #617, "How a beam turns" item 1: after an unforeseen cause (a seek or jump, a reload, a lost or regained lock, a resume)
// the limiter holds every beam on its present aim for 2 s of class-clock time, then turns at the normal rate. A planned
// change does not hold. The hold is on the class clock, never wall time. Rule 4: the cause's time is the only new input.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Direction } from "../src/beams.ts";
import type { LinkInput } from "../src/beat-level.ts";
import { MAX_DEG_PER_SECOND } from "../src/energy.ts";
import { START_STATE, stepRig } from "../src/step.ts";
import type { RigState, StepInput } from "../src/step.ts";
import { UNFORESEEN_HOLD_MS, causeFrame, endRunsAtCauses, linkCause, pulledFixed } from "../src/unforeseen.ts";
import type { UnforeseenCause } from "../src/unforeseen.ts";
import { angleBetween } from "../src/turn.ts";
import { classA, classSameZones } from "./fixtures.ts";

const locked: LinkInput = { state: "Locked" };
const DT = 1 / 60;
type Over = Partial<StepInput>;
const input = (classMs: number, songPosMs: number, over: Over = {}): StepInput =>
  ({ cls: classA, classMs, songIndex: 0, songPosMs, link: locked, rawDtSeconds: DT, ...over });

/** Settles the rig on a position under each link in turn (10 frames each), then returns its state. */
function settled(songPosMs: number, links: readonly LinkInput[] = [locked]): RigState {
  let s = START_STATE;
  let ms = 1000;
  for (const link of links) for (let i = 0; i < 10; i++, ms += 16) s = stepRig(s, input(ms, songPosMs, { link })).state;
  return s;
}
const same = (a: readonly Direction[], b: readonly Direction[]) => a.every((d, i) => angleBetween(d, b[i]!) === 0);

// Song 0 at 120 bpm flips its phrase (mirrors every pan) at 16 s: 15 s and 20 s have different targets, and the Beat level
// (locked) is mirrored at 20 s where no lock is not. Each case isolates one cause: the link event or the jump is the only thing that changes.
interface Case { readonly name: string; readonly cause: UnforeseenCause; readonly settleAt: number; readonly before: readonly LinkInput[]; readonly after: LinkInput; readonly host?: UnforeseenCause }
const coasting: LinkInput = { state: "Coasting" };
const CASES: readonly Case[] = [
  { name: "a seek", cause: "seek", settleAt: 15_000, before: [locked], after: locked },
  { name: "a jump named by the host", cause: "jump", settleAt: 15_000, before: [locked], after: locked, host: "jump" },
  { name: "a reload named by the host", cause: "reload", settleAt: 15_000, before: [locked], after: locked, host: "reload" },
  { name: "a lost lock", cause: "lock lost", settleAt: 20_000, before: [locked], after: coasting },
  { name: "a regained lock", cause: "lock regained", settleAt: 20_000, before: [coasting], after: locked },
  { name: "a resume (to a state with no lock, so not a regained lock)", cause: "resume", settleAt: 20_000, before: [locked, { state: "Paused" }], after: coasting },
  { name: "a resume from a hold of the link (to a state with no lock)", cause: "resume", settleAt: 20_000, before: [locked, { state: "Locked", held: true }], after: coasting },
];

for (const c of CASES) {
  test(`${c.name}: every beam stays on its present aim for 2 s of class-clock time, then turns at the limit`, () => {
    const base = settled(c.settleAt, c.before);
    const aim = base.drawn!;
    const at = base.lastClassMs! + (c.cause === "seek" ? 5000 : 16); // a seek moves the class clock
      const where = (ms: number): StepInput => input(ms, 20_000 + (ms - at), { link: c.after, ...(c.host ? { cause: c.host } : {}) });
    const frame0 = stepRig(base, where(at));
    assert.equal(frame0.cause, c.cause, `${c.name} is seen as ${c.cause}`);
    assert.ok(frame0.held && same(frame0.drawn, aim), "the cause's own frame holds the present aim");
    assert.ok(frame0.frame.directions.some((d, i) => angleBetween(d, aim[i]!) > 5), "the target did change, so the hold is doing the work");
    let s = frame0.state;
    let ms = at;
    const later = (m: number): StepInput => ({ ...where(m), cause: undefined }); // the host names the cause on its frame only
    while (ms + 16 < at + UNFORESEEN_HOLD_MS) {
      ms += 16;
      const f = stepRig(s, later(ms));
      assert.equal(f.cause, null, "no second cause in the hold");
      assert.ok(f.held && same(f.drawn, aim), `still held at +${ms - at} ms`);
      s = f.state;
    }
    // The hold ends on the class clock; from there it turns at no more than 30 degrees a second.
    let turned = 0;
    for (let i = 0; i < 80; i++) {
      ms += 16;
      const f = stepRig(s, later(ms));
      f.drawn.forEach((d, k) => {
        const moved = angleBetween(s.drawn![k]!, d);
        assert.ok(moved / f.dtSeconds <= MAX_DEG_PER_SECOND * 1.000001);
        turned = Math.max(turned, moved);
      });
      s = f.state;
    }
    assert.ok(turned > 0.3, `the beams turn once the hold is over: ${turned}`);
  });
}

test("a planned change (a phrase flip, a song change) does not hold: the beam starts turning on the frame the target changes", () => {
  let s = stepRig(START_STATE, input(15_900, 15_900)).state;
  let prevTargets = stepRig(START_STATE, input(15_900, 15_900)).frame.directions;
  let jumpedAt = -1;
  for (let ms = 15_916; ms < 16_300; ms += 16) {
    const f = stepRig(s, input(ms, ms));
    assert.equal(f.cause, null);
    assert.equal(f.held, false);
    if (jumpedAt < 0 && f.frame.directions.some((d, i) => angleBetween(d, prevTargets[i]!) > 20)) {
      jumpedAt = ms; // the phrase flip changes the target here: the beam is already moving toward it on this very frame
      assert.ok(f.drawn.some((d, i) => angleBetween(d, s.drawn![i]!) > 0.1), "turns on the frame the target changes");
    }
    prevTargets = f.frame.directions;
    s = f.state;
  }
  assert.ok(jumpedAt >= 16_000 && jumpedAt <= 16_050, `the flip is at 16 s: ${jumpedAt}`);
  const change = stepRig(settled(5000), { ...input(1160, 0), songIndex: 1 });
  assert.equal(change.held, false);
  assert.equal(change.cause, null);
});

test("the hold is on the class clock, not wall time: a class clock that stands still never ends it, and frame rate does not move its end", () => {
  const base = settled(15_000);
  const seek = stepRig(base, input(30_000, 20_000));
  let s = seek.state;
  for (let i = 0; i < 600; i++) { // 10 s of wall time at 60 fps with the class clock standing still
    const f = stepRig(s, input(30_000, 20_000));
    assert.ok(f.held && same(f.drawn, base.drawn!));
    s = f.state;
  }
  for (const fps of [30, 60, 144]) {
    let t = seek.state;
    let ms = 30_000;
    let endedAt = 0;
    while (ms < 33_000 && endedAt === 0) {
      ms += 1000 / fps;
      const f = stepRig(t, input(ms, 20_000 + (ms - 30_000), { rawDtSeconds: 1 / fps }));
      if (!f.held) endedAt = ms - 30_000;
      t = f.state;
    }
    assert.ok(endedAt >= 2000 && endedAt < 2000 + 1000 / fps + 1, `@${fps}: held until ${endedAt}`);
  }
});

test("a later cause inside the hold starts the 2 s again; the motion phase stands still in the hold and goes on from where it stopped", () => {
  const base = settled(15_000);
  const a = stepRig(base, input(20_000, 20_000));
  let s = a.state;
  for (let ms = 20_016; ms < 21_500; ms += 16) s = stepRig(s, input(ms, ms)).state;
  const b = stepRig(s, input(26_000, 26_000)); // a second seek, 1.5 s into the first hold
  assert.equal(b.cause, "seek");
  s = b.state;
  for (let ms = 26_016; ms < 27_990; ms += 16) { const f = stepRig(s, input(ms, ms)); assert.ok(f.held, `held at ${ms}`); s = f.state; }
  assert.equal(s.phaseDeg, base.phaseDeg, "the phase did not move in the hold");
  for (let ms = 28_000; ms < 29_000; ms += 16) s = stepRig(s, input(ms, ms)).state;
  assert.ok(s.phaseDeg > base.phaseDeg, "the phase runs again after the hold");
});

test("rule 4: classes that differ only in intervals draw the same beams through the same seeks and link events", () => {
  let [a, b]: [RigState, RigState] = [START_STATE, START_STATE];
  let ms = 1000;
  let held = 0;
  for (let n = 0; n < 2500; n++) {
    const k = n % 400;
    ms = k === 0 && n > 0 ? 40_000 - n * 5 : ms + 16; // a seek every 400 frames
    const link: LinkInput = k >= 150 && k < 160 ? { state: "Coasting" } : k >= 300 && k < 310 ? { state: "Paused" } : locked;
    const shared = { classMs: ms, songIndex: 0, songPosMs: ms % 50_000, link, rawDtSeconds: DT };
    const [ra, rb] = [stepRig(a, { cls: classA, ...shared }), stepRig(b, { cls: classSameZones, ...shared })];
    assert.deepEqual(ra.drawn, rb.drawn, `frame ${n}`);
    assert.equal(ra.held, rb.held);
    if (ra.held) held++;
    [a, b] = [ra.state, rb.state];
  }
  assert.ok(held > 300, `the run really held: ${held}`);
});

test("linkCause: resume, lost and regained lock; nothing for steady or unrelated changes", () => {
  assert.equal(linkCause(null, locked), null);
  assert.equal(linkCause(locked, locked), null);
  assert.equal(linkCause(locked, { state: "Coasting" }), "lock lost");
  assert.equal(linkCause({ state: "Coasting" }, locked), "lock regained");
  assert.equal(linkCause({ state: "Paused" }, { state: "Coasting" }), "resume");
  assert.equal(linkCause({ state: "Locked", held: true }, locked), "resume");
  assert.equal(linkCause({ state: "Coasting" }, { state: "Off the list" }), null);
  assert.equal(linkCause(locked, { state: "Paused" }), "lock lost");
  assert.equal(linkCause(locked, { state: "Locked", held: true }), "lock lost"); // the link's hold is no lock (scene.md): a lost lock, and a resume on leaving it
});

const wish = { id: "r", kind: "ramp" as const, pieces: [] };
const run = (...pieces: [number, number][]) => ({ wish, pieces: pieces.map(([fromMs, toMs]) => ({ fromMs, toMs })) });

test("endRunsAtCauses: a run in progress ends in the cause's frame, merged with its mark; a run elsewhere is untouched", () => {
  const out = endRunsAtCauses([run([1000, 1700]), run([5000, 5700])], [{ atMs: 1300, frameMs: 1500 }]);
  assert.deepEqual(out.runs[0]!.pieces, [{ fromMs: 1000, toMs: 1500 }]);
  assert.deepEqual(out.runs[1]!.pieces, [{ fromMs: 5000, toMs: 5700 }]);
  assert.deepEqual(out.absorbed, [1500]);
  // A run that ends before its cause's frame is not extended; a cause after the run (or before it) cuts nothing.
  assert.deepEqual(endRunsAtCauses([run([1000, 1400])], [{ atMs: 1300, frameMs: 1500 }]).runs[0]!.pieces, [{ fromMs: 1000, toMs: 1400 }]);
  assert.deepEqual(endRunsAtCauses([run([1000, 1400])], [{ atMs: 1400, frameMs: 1500 }]).absorbed, []);
  assert.deepEqual(endRunsAtCauses([run([1000, 1400])], [{ atMs: 900, frameMs: 950 }]).absorbed, []);
});

test("endRunsAtCauses: a two-piece run (a dim) loses every piece after the cut, whether the cause is in a piece or in the gap", () => {
  const dim = run([1000, 1120], [1500, 1620]);
  const inFirst = endRunsAtCauses([dim], [{ atMs: 1050, frameMs: 1100 }]);
  assert.deepEqual(inFirst.runs[0]!.pieces, [{ fromMs: 1000, toMs: 1100 }], "the second piece is gone");
  const inGap = endRunsAtCauses([dim], [{ atMs: 1300, frameMs: 1350 }]);
  assert.deepEqual(inGap.runs[0]!.pieces, [{ fromMs: 1000, toMs: 1120 }], "the first piece is whole, the second is gone");
  assert.deepEqual(inGap.absorbed, []); // the first piece ended 230 ms before the frame: the mark is a change of its own
  assert.deepEqual(endRunsAtCauses([dim], [{ atMs: 1300, frameMs: 1130 }], 20).absorbed, [1130], "a run that ends in the mark frame (within a frame) is one change with it");
  const inSecond = endRunsAtCauses([dim], [{ atMs: 1550, frameMs: 1580 }]);
  assert.deepEqual(inSecond.runs[0]!.pieces, [{ fromMs: 1000, toMs: 1120 }, { fromMs: 1500, toMs: 1580 }]);
  const frameInGap = endRunsAtCauses([dim], [{ atMs: 1100, frameMs: 1130 }]); // the frame falls after piece one ended
  assert.deepEqual(frameInGap.runs[0]!.pieces, [{ fromMs: 1000, toMs: 1120 }]);
  const two = endRunsAtCauses([dim], [{ atMs: 1050, frameMs: 1100 }, { atMs: 1550, frameMs: 1580 }]);
  assert.deepEqual(two.runs[0]!.pieces, [{ fromMs: 1000, toMs: 1100 }], "a second cause finds the run already cut");
});

const FRAME = 10;
test("causeFrame: P2 against shown marks, 1 s after an ended run, at most 1 s late; a frame rounded past that by one frame is allowed", () => {
  assert.equal(causeFrame(1000, FRAME, [800], []), 1300); // 500 ms after the shown mark
  assert.equal(causeFrame(1000, FRAME, [], [run([700, 900])]), 1900); // 1 s after the run's end
  assert.equal(causeFrame(10005, FRAME, [], [run([9000, 10005])]), 11010); // a run ended in the cause's frame: one frame of rounding past 1 s
  assert.equal(causeFrame(1000, FRAME, [900, 1400, 1900], []), null); // 2400 is more than a second late: no frame
});

test("causeFrame: a cause joins the following fixed frame, or an earlier cause's mark in its window (one change)", () => {
  assert.equal(causeFrame(1000, FRAME, [800], [], [], [1100]), 1600, "own frame 500 ms after the fixed frame");
  assert.equal(causeFrame(1000, FRAME, [1050, 1550, 2050], [], [], [1900]), 1900, "no free frame of its own: joins the fixed frame");
  assert.equal(causeFrame(1000, FRAME, [], [], [1400], []), 1400, "an earlier cause's mark in its window");
});

test("decision 7: a cause in a run whose own frame comes after the run's end takes the run's end frame as its mark", () => {
  assert.equal(causeFrame(52783, FRAME, [52633], [run([52736, 52986])]), 52990); // not 53133, which is 500 ms after the shown tick
  assert.equal(causeFrame(1300, FRAME, [], [run([1000, 1700])]), 1300, "its own frame is inside the run: the run is cut there");
});

test("decision 8: a fixed frame less than 500 ms after the earliest allowed frame and past cause + 1 s is pulled to it", () => {
  assert.equal(causeFrame(34710, FRAME, [33850], [run([34436, 34686])], [], [36067]), 35690);
  assert.equal(pulledFixed(35690, 34710, FRAME, [36067]), 36067);
  assert.equal(pulledFixed(35690, 34710, FRAME, [35700]), undefined, "a frame inside cause + 1 s is not pulled");
  assert.equal(pulledFixed(35690, 34710, FRAME, [36300]), undefined, "500 ms or more away is not pulled");
});
