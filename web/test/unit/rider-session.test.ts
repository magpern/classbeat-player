// The rider's live session and what it shows (docs/design/rider.md, "In the class" and "Ending";
// ADR 0007 section 5): seq and run, the countdown run on with the monotonic clock only while
// running and live, held while the instructor is away, gone 10 s after the phone's own connection
// dropped, the close codes, and the words of each state.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_NUMBERS } from "../../src/rider/core/effort-calc.ts";
import { CLOSE_ENDED, CLOSE_REFUSED, CLOSE_REPLACED, startLive, step } from "../../src/rider/core/session.ts";
import type { Event, Live } from "../../src/rider/core/session.ts";
import { liveView, whoWords } from "../../src/rider/core/view.ts";
import type { RunView } from "../../src/rider/core/view.ts";
import type { RiderState } from "../../src/rider/core/wire.ts";
import { examples } from "../lib/live-examples.ts";

const STATES = examples("rider-state", "valid").map((e) => e.value as RiderState);
const RUNNING = STATES.find((s) => s.status === "running") as RiderState;
const with_ = (s: RiderState, o: Partial<RiderState>): RiderState => ({ ...s, ...o });

const msg = (m: Event & { type: "message" }): Event => m;
const welcome = (at: number, hostConnected = true): Event => msg({ type: "message", at, msg: { type: "welcome", hostConnected } });
const state = (at: number, s: RiderState): Event => msg({ type: "message", at, msg: { type: "rider_state", state: s } });
const hostStatus = (at: number, connected: boolean): Event => msg({ type: "message", at, msg: { type: "host_status", connected } });
const closed = (at: number, code: number): Event => ({ type: "closed", at, code });

const run = (events: readonly Event[]): Live => events.reduce(step, startLive());
const view = (l: Live, at: number): RunView => {
  const v = liveView(l, at, "Anna", NO_NUMBERS);
  assert.equal(v.kind, "run");
  return v as RunView;
};

describe("the rider's session", () => {
  it("ignores an older or equal seq in the same run and takes any state of a new run", () => {
    const a = run([welcome(0), state(0, RUNNING)]);
    const older = step(a, state(100, with_(RUNNING, { seq: RUNNING.seq - 1, classRemainingMs: 1 })));
    assert.equal(older.state, a.state);
    const same = step(a, state(100, with_(RUNNING, { classRemainingMs: 1 })));
    assert.equal(same.state, a.state);
    const newer = step(a, state(100, with_(RUNNING, { seq: RUNNING.seq + 1 })));
    assert.equal(newer.state?.seq, RUNNING.seq + 1);
    const otherRun = step(a, state(100, with_(RUNNING, { run: "T3RoZXJSdW4tMDAwMDAwMg", seq: 0 })));
    assert.equal(otherRun.state?.run, "T3RoZXJSdW4tMDAwMDAwMg");
  });

  it("runs the countdown on only while running, at most 10 s past the last state", () => {
    const l = run([welcome(0), state(0, RUNNING)]);
    assert.equal(view(l, 0).clock?.time, "0:46");
    assert.equal(view(l, 2500).clock?.time, "0:43");
    assert.equal(view(l, 2500).top.time, "32:23"); // 1946 s less 2.5 s
    assert.equal(view(l, 60_000).clock?.time, "0:36", "never more than 10 s past the last state");
    const paused = run([welcome(0), state(0, with_(RUNNING, { status: "paused" }))]);
    assert.equal(view(paused, 5000).clock?.time, "0:46");
    assert.equal(view(paused, 5000).clock?.pill, "Paused");
    const g = view(paused, 5000).gel;
    assert.ok(!g.blank && g.down);
  });

  it("holds the countdown while the instructor is away and carries on from there when back", () => {
    const l = run([welcome(0), state(0, RUNNING), hostStatus(2000, false)]);
    const v = view(l, 8000);
    assert.equal(v.clock?.time, "0:44");
    assert.equal(v.clock?.label, "Interval left, not live");
    assert.equal(v.clock?.est, true);
    assert.equal(v.top.alert, "Waiting for the instructor");
    assert.equal(v.gel.blank === false && v.gel.down, true);
    const back = step(l, hostStatus(9000, true));
    assert.equal(view(back, 9000).clock?.time, "0:44", "no jump when the instructor is back");
    assert.equal(view(back, 9000).top.alert, null);
  });

  it("joined while the instructor is away with no state: the waiting page", () => {
    const l = run([welcome(0, false)]);
    assert.deepEqual(liveView(l, 0, "Anna", NO_NUMBERS), { kind: "waiting", who: "Joined as Anna", down: false });
    assert.deepEqual(liveView(startLive(), 0, "Anna", NO_NUMBERS), { kind: "joining" });
  });

  it("the phone's own connection dropped: Reconnecting, the countdown runs on, and goes after 10 s", () => {
    const l = run([welcome(0), state(0, RUNNING), closed(1000, 1006)]);
    const v = view(l, 3000);
    assert.equal(v.top.alert, "Reconnecting");
    assert.equal(v.clock?.time, "0:43");
    assert.equal(v.clock?.label, "Interval left, not live");
    assert.equal(view(l, 11_000).clock?.time, "0:36");
    assert.equal(view(l, 11_001).clock, null);
    assert.ok(view(l, 11_001).effort, "the effort and the next rows stay");
    const back = run([welcome(0), state(0, RUNNING), closed(1000, 1006), { type: "connecting", at: 2000 }, welcome(2500), state(2600, with_(RUNNING, { seq: RUNNING.seq + 1 }))]);
    assert.equal(view(back, 2600).top.alert, null);
    assert.equal(view(back, 2600).clock?.label, "Interval left");
  });

  it("the close codes and ended: lapsed, removed or ended, and nothing after", () => {
    const base = [welcome(0), state(0, RUNNING)];
    assert.equal(run([...base, closed(10, CLOSE_REFUSED)]).gone, "lapsed");
    assert.equal(run([...base, closed(10, CLOSE_ENDED)]).gone, "ended");
    assert.equal(run([...base, closed(10, CLOSE_REPLACED)]).gone, "ended");
    const removed = run([...base, msg({ type: "message", at: 10, msg: { type: "ended", reason: "dropped" } })]);
    assert.equal(removed.gone, "removed");
    assert.deepEqual(liveView(removed, 10, "Anna", NO_NUMBERS), { kind: "removed" });
    for (const reason of ["host_ended", "revoked", "expired"] as const) {
      assert.equal(run([...base, msg({ type: "message", at: 10, msg: { type: "ended", reason } })]).gone, "ended", reason);
    }
    assert.equal(step(removed, welcome(20)), removed);
  });
});

describe("the class view's words", () => {
  it("names the states as the spec does", () => {
    const at = (s: RiderState): RunView => view(run([welcome(0), state(0, s)]), 0);
    assert.equal(at(RUNNING).clock?.label, "Interval left");
    assert.equal(at(with_(RUNNING, { status: "holding" })).clock?.label, "Until the next song");
    assert.equal(at(with_(RUNNING, { next: [] })).clock?.label, "Last interval");
    assert.deepEqual(at(with_(RUNNING, { next: [] })).coming, []);
    const before = at(with_(RUNNING, { status: "not_started" }));
    assert.equal(before.clock?.label, "First interval");
    assert.deepEqual([before.top.time, before.top.timeLabel], ["45:00", "class"]);
    assert.equal(before.gel.blank === false && before.gel.label, "First zone");
    const test = at(with_(RUNNING, { now: { ...RUNNING.now, test: { kind: "ftp", minutes: 20 } } }));
    assert.equal(test.gel.blank === false && test.gel.label, "FTP test, 20 min");
    assert.equal(at(RUNNING).clock?.position, "Seated");
    assert.equal(at(with_(RUNNING, { now: { ...RUNNING.now, position: null } })).clock?.position, null);
    assert.deepEqual(at(RUNNING).coming?.[0], [2, "Endurance", "1:00"]);
    assert.equal(at(RUNNING).top.who, "Joined as Anna");
    assert.equal(whoWords(null), "Joined");
  });

  it("class complete: a white gel with the length ridden, no effort, no next rows, no key", () => {
    const v = view(run([welcome(0), state(0, with_(RUNNING, { status: "ended" }))]), 0);
    assert.deepEqual(v.gel, { blank: true, name: "Class complete", sub: "45:00 ridden" });
    assert.deepEqual([v.clock, v.effort, v.coming, v.done], [null, null, null, true]);
    assert.deepEqual([v.top.time, v.top.timeLabel], ["45:00", "ridden"]);
  });

  it("shows nothing of any other rider and never a number from a past ride", () => {
    for (const s of STATES) {
      const text = JSON.stringify(view(run([welcome(0), state(0, s)]), 0));
      assert.doesNotMatch(text, /riders?\b|rank|leader|nickname/i, "only this rider's own view");
    }
  });
});
