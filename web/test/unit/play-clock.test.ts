// The manual clock as the web player page runs it (ADR 0008, section 4; acceptance criterion 3): the
// same behaviour as on the computer, over the shared clock surface alone. Every state is a function
// of the commands and the monotonic time, so the tests drive it with numbers: start, pause, resume,
// next, previous, the 5-second jumps and the end.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STATE_FIXTURES } from "../../src/fixtures/states.ts";
import { toRoomModel } from "../../src/room/adapter.ts";
import type { Class } from "../../src/room/input.ts";
import { roomInput } from "../../src/play/room-input.ts";
import { advance, apply, mainCommand, mainWord, msToNextSecond, openClass, statusOf, viewOf } from "../../src/play/session.ts";
import type { Command, Session } from "../../src/play/session.ts";

const doc = STATE_FIXTURES.running.doc as Class;
// 17 intervals: 3:00, 2:00, 4:00, 2:00, 4:00, 2:59, 1:30, 0:45, 1:30, 1:30, 5:00, … 42:00 in all.
const START = 1_000;
const S = 1000;

const run = (s: Session, ...steps: readonly (readonly [Command, number])[]): Session => steps.reduce((acc, [c, at]) => apply(acc, c, at), s);
const ms = (s: Session, now: number): number => viewOf(s, now).classMs;

describe("the manual clock on the web page", () => {
  it("is ready at the start and runs only after Start", () => {
    const s = openClass(doc, START);
    assert.equal(statusOf(s), "ready");
    assert.equal(ms(s, START + 10 * S), 0, "a ready clock does not move");
    const r = apply(s, "start", START + 5 * S);
    assert.equal(statusOf(r), "running");
    assert.equal(ms(r, START + 15 * S), 10 * S);
    assert.equal(viewOf(r, START + 15 * S).intervalRemainingMs, 170 * S);
  });

  it("pauses at the time it was paused and resumes from there", () => {
    let s = run(openClass(doc, START), ["start", START], ["pause", START + 20 * S]);
    assert.equal(statusOf(s), "paused");
    assert.equal(ms(s, START + 90 * S), 20 * S, "a paused clock holds");
    s = apply(s, "resume", START + 90 * S);
    assert.equal(statusOf(s), "running");
    assert.equal(ms(s, START + 100 * S), 30 * S);
  });

  it("Next goes to the start of the next interval, and nothing happens on the last one", () => {
    let s = run(openClass(doc, START), ["start", START], ["next", START + 10 * S]);
    assert.equal(ms(s, START + 10 * S), 180 * S);
    assert.equal(viewOf(s, START + 10 * S).intervalIndex, 1);
    assert.equal(statusOf(s), "running", "a running clock keeps running");
    for (let i = 0; i < 40; i += 1) s = apply(s, "next", START + 10 * S);
    assert.equal(viewOf(s, START + 10 * S).nextIntervalIndex, null, "the last interval");
    const before = ms(s, START + 10 * S);
    assert.equal(ms(apply(s, "next", START + 10 * S), START + 10 * S), before);
  });

  it("Previous goes to the start of the interval, or to the one before it within 3 s of its start", () => {
    // 20 s into the first interval: back to its start.
    let s = run(openClass(doc, START), ["start", START], ["previous", START + 20 * S]);
    assert.equal(ms(s, START + 20 * S), 0);
    // In the second interval 2 s after it began: the first interval's start.
    s = run(openClass(doc, START), ["start", START], ["next", START + 1], ["previous", START + 1 + 2 * S]);
    assert.equal(ms(s, START + 1 + 2 * S), 0, "within 3 s of the start: the interval before");
    // 10 s into the second interval: its own start.
    s = run(openClass(doc, START), ["start", START], ["next", START], ["previous", START + 10 * S]);
    assert.equal(ms(s, START + 10 * S), 180 * S);
  });

  it("Forward and Back move 5 s, never past the start or the end", () => {
    let s = run(openClass(doc, START), ["start", START], ["forward", START + 10 * S]);
    assert.equal(ms(s, START + 10 * S), 15 * S);
    s = apply(s, "back", START + 10 * S);
    assert.equal(ms(s, START + 10 * S), 10 * S);
    s = run(openClass(doc, START), ["start", START], ["back", START + 2 * S]);
    assert.equal(ms(s, START + 2 * S), 0, "no earlier than the start");
    s = run(openClass(doc, START), ["start", START], ["forward", START + 2515 * S]);
    assert.equal(ms(s, START + 2515 * S), 2520 * S, "no later than the end");
  });

  it("holds at the end: Class Complete, the clock stays at the class length", () => {
    let s = run(openClass(doc, START), ["start", START]);
    s = advance(s, START + 2519 * S);
    assert.equal(statusOf(s), "running");
    s = advance(s, START + 2521 * S);
    assert.equal(statusOf(s), "ended");
    assert.equal(ms(s, START + 9999 * S), 2520 * S);
    assert.equal(viewOf(s, START + 9999 * S).holding, true);
    assert.equal(mainCommand("ended"), null);
    // Time never runs backwards by itself: an earlier reading is the latest seen.
    assert.equal(ms(advance(s, START), START), 2520 * S);
  });

  it("before the start Previous and Next move the starting point and the clock stays ready", () => {
    let s = openClass(doc, START);
    s = apply(s, "next", START + S);
    s = apply(s, "next", START + 2 * S);
    assert.equal(statusOf(s), "ready");
    assert.equal(ms(s, START + 60 * S), 300 * S, "two intervals on: 3:00 and 2:00");
    s = apply(s, "previous", START + 3 * S);
    assert.equal(ms(s, START + 3 * S), 180 * S);
    s = apply(s, "start", START + 10 * S);
    assert.equal(ms(s, START + 20 * S), 190 * S, "Start runs from the starting point");
  });

  it("the main button and Space follow the state", () => {
    assert.deepEqual(["ready", "running", "paused", "ended"].map((x) => mainCommand(x as "ready")), ["start", "pause", "resume", null]);
    assert.deepEqual(["ready", "running", "paused"].map((x) => mainWord(x as "ready")), ["Start", "Pause", "Resume"]);
  });

  it("Previous from Class Complete leaves the clock paused at the last interval, for the instructor to resume", () => {
    let s = advance(run(openClass(doc, START), ["start", START]), START + 3000 * S);
    assert.equal(statusOf(s), "ended");
    s = apply(s, "previous", START + 3000 * S);
    assert.equal(statusOf(s), "paused");
    assert.equal(viewOf(s, START + 3000 * S).nextIntervalIndex, null);
  });
});

describe("when a running clock redraws", () => {
  it("at the next whole second of the countdown, the time left or the time done, a few ms past it", () => {
    const s = apply(openClass(doc, START), "start", START);
    // 3 s into a 180 s interval (2:57 left): the next change is in 1 s.
    assert.equal(msToNextSecond(viewOf(s, START + 3000)), 1004);
    // 250 ms past a second: 750 ms to the next one.
    assert.equal(msToNextSecond(viewOf(s, START + 3250)), 754);
    // 999 ms past: 1 ms away.
    assert.equal(msToNextSecond(viewOf(s, START + 3999)), 5);
    // Never zero or negative, and never longer than a second and a few ms.
    for (let t = 0; t < 5000; t += 137) {
      const d = msToNextSecond(viewOf(s, START + t));
      assert.ok(d > 0 && d <= 1004, `${t}: ${d}`);
    }
  });

  it("a whole second change is on screen when the redraw comes", () => {
    const s = apply(openClass(doc, START), "start", START);
    let at = START + 3250;
    for (let i = 0; i < 20; i += 1) {
      const before = viewOf(s, at);
      at += msToNextSecond(before);
      const after = viewOf(s, at);
      assert.notEqual(Math.floor(after.intervalRemainingMs / 1000), Math.floor(before.intervalRemainingMs / 1000), "the countdown moved");
    }
  });
});

describe("the room screen's input from the clock", () => {
  const link = (s: Session, now: number) => roomInput(doc, viewOf(s, now), null).link;

  it("is always the manual clock: nothing follows, holds or guesses", () => {
    for (const s of [openClass(doc, START), run(openClass(doc, START), ["start", START]), run(openClass(doc, START), ["start", START], ["pause", START + S])]) {
      assert.deepEqual({ ...link(s, START + 5 * S), songIndex: 0, classRemainingMs: 0 }, {
        mode: "manual", available: false, state: "Manual", guessing: false, songIndex: 0, held: false, holdRemainingMs: null, candidates: [], announcement: null, classRemainingMs: 0,
      });
    }
  });

  it("draws before the start, running, paused and Class Complete, with Manual clock in the link slot", () => {
    const model = (s: Session, now: number, notice: "reloaded" | "screen-may-turn-off" | null = null) => toRoomModel(roomInput(doc, viewOf(s, now), notice));
    const ready = openClass(doc, START);
    assert.equal(model(ready, START).kind, "before-start");
    assert.equal(model(ready, START).rail.link?.text, "Press Start");
    const running = apply(ready, "start", START);
    assert.equal(model(running, START + 5 * S).kind, "running");
    assert.equal(model(running, START + 5 * S).rail.link?.text, "Manual clock");
    assert.equal(model(running, START + 5 * S).beat, null, "no beat dot: no music link");
    assert.equal(model(apply(running, "pause", START + 5 * S), START + 6 * S).clock?.pill, true);
    assert.equal(model(advance(running, START + 9999 * S), START + 9999 * S).kind, "finished");
  });

  it("a moved starting point stays the screen before the start, on the zone it points at", () => {
    const moved = apply(openClass(doc, START), "next", START);
    const m = toRoomModel(roomInput(doc, viewOf(moved, START), null));
    assert.equal(m.kind, "before-start");
    assert.equal(m.gel?.label, "Starts here");
    assert.equal(m.gel?.zone, 2);
    assert.equal(toRoomModel(roomInput(doc, viewOf(openClass(doc, START), START), null)).gel?.label, "First zone");
  });

  it("the two notices are fixed words in the link slot, white with a square", () => {
    const r = openClass(doc, START);
    const running = apply(r, "start", START);
    const reloaded = toRoomModel(roomInput(doc, viewOf(r, START), "reloaded")).rail.link;
    assert.deepEqual(reloaded, { text: "Reloaded: back to the start", look: "manual", news: true });
    const wake = toRoomModel(roomInput(doc, viewOf(running, START + S), "screen-may-turn-off")).rail.link;
    assert.deepEqual(wake, { text: "Screen may turn off", look: "manual", news: true });
  });
});
