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
import { UNFORESEEN_HOLD_MS, endRunsAtCauses, linkCause } from "../src/unforeseen.ts";
import { angleBetween } from "../src/turn.ts";
import { classA, classSameZones } from "./fixtures.ts";

const locked: LinkInput = { state: "Locked" };
const DT = 1 / 60;
type Over = Partial<StepInput>;
const input = (classMs: number, songPosMs: number, over: Over = {}): StepInput =>
  ({ cls: classA, classMs, songIndex: 0, songPosMs, link: locked, rawDtSeconds: DT, ...over });

/** Settles the rig on a position, then returns its state. */
function settled(songPosMs: number, over: Over = {}): RigState {
  let s = stepRig(START_STATE, input(1000, songPosMs, over)).state;
  for (let i = 1; i < 10; i++) s = stepRig(s, input(1000 + i * 16, songPosMs, over)).state;
  return s;
}
const same = (a: readonly Direction[], b: readonly Direction[]) => a.every((d, i) => angleBetween(d, b[i]!) === 0);

// Song 0 at 120 bpm flips its phrase (mirrors every pan) at 16 s: 15 s and 20 s have different targets.
const CAUSES: readonly [string, (s: RigState) => { s: RigState; at: number; over: Over; first: Over }][] = [
  ["a seek", (s) => ({ s, at: 20_000, over: {}, first: { songPosMs: 20_000 } })],
  ["a jump named by the host", (s) => ({ s, at: 20_000, over: {}, first: { songPosMs: 20_000, cause: "jump" } })],
  ["a reload named by the host", (s) => ({ s, at: s.lastClassMs! + 16, over: {}, first: { songPosMs: 20_000, cause: "reload" } })],
  ["a lost lock", (s) => ({ s, at: s.lastClassMs! + 16, over: {}, first: { songPosMs: 20_000, link: { state: "Coasting" } } })], // mirrored phrase at 20 s locked; none coasting
  ["a regained lock", (s) => ({ s, at: s.lastClassMs! + 16, over: { link: { state: "Coasting" } }, first: { songPosMs: 20_000, link: locked } })],
  ["a resume", (s) => ({ s, at: s.lastClassMs! + 16, over: { link: { state: "Paused" } }, first: { songPosMs: 20_000, link: locked } })],
];

for (const [name, make] of CAUSES) {
  test(`${name}: every beam stays on its present aim for 2 s of class-clock time, then turns at the limit`, () => {
    const probe = name === "a regained lock" || name === "a resume" ? { link: { state: "Coasting" } as LinkInput } : {};
    const base = settled(name === "a lost lock" ? 20_000 : 15_000, name === "a resume" ? { link: { state: "Paused" } } : probe);
    const { at, over, first } = make(base);
    const aim = base.drawn!;
    let s = base;
    const classAt = (ms: number): Over => ({ classMs: ms, songPosMs: 20_000 + (ms - at), ...over });
    const frame0 = stepRig(s, input(at, 20_000, { ...over, ...first }));
    assert.ok(frame0.cause !== null, `${name} is seen as a cause`);
    assert.ok(frame0.held && same(frame0.drawn, aim), "the cause's own frame holds the present aim");
    assert.notDeepEqual(frame0.frame.directions, aim, "the target did change, so the hold is doing the work");
    s = frame0.state;
    let ms = at;
    while (ms + 16 < at + UNFORESEEN_HOLD_MS) {
      ms += 16;
      const f = stepRig(s, { ...input(ms, 0), ...classAt(ms), link: first.link ?? over.link ?? locked });
      assert.ok(f.held && same(f.drawn, aim), `still held at +${ms - at} ms`);
      s = f.state;
    }
    // The hold ends on the class clock; from there it turns at no more than 30 degrees a second.
    let turned = 0;
    for (let i = 0; i < 80; i++) {
      ms += 16;
      const f = stepRig(s, { ...input(ms, 0), ...classAt(ms), link: first.link ?? over.link ?? locked });
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
});

test("endRunsAtCauses: a run in progress ends one frame before the cause's frame; a run elsewhere is untouched", () => {
  const wish = { id: "r", kind: "ramp" as const, pieces: [] };
  const runs = [{ wish, pieces: [{ fromMs: 1000, toMs: 1700 }] }, { wish, pieces: [{ fromMs: 5000, toMs: 5700 }] }];
  const out = endRunsAtCauses(runs, [{ atMs: 1300, frameMs: 1500 }], 10);
  assert.deepEqual(out[0]!.pieces, [{ fromMs: 1000, toMs: 1490 }]);
  assert.deepEqual(out[1]!.pieces, runs[1]!.pieces);
});
