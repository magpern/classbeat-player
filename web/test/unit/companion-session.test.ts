// The live session's state machine (src/companion/core/session.ts) on recorded messages: seq and
// run, a press with its pending, ack, late ack and timeout, and the close codes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACK_WITHIN_MS, CLOSE_ENDED, CLOSE_REFUSED, CLOSE_REPLACED, NOTE_MS, NOTICE_MS, isLive, isSending, press, startLive, step } from "../../src/companion/core/session.ts";
import type { Live } from "../../src/companion/core/session.ts";
import { REFUSAL_WORDS, NO_ANSWER, flashNotice } from "../../src/companion/core/words.ts";
import { ACK_REASONS } from "../../src/companion/core/wire.ts";
import { connected, msg, recorded, stateMsg, variant } from "../lib/companion-states.ts";

const ID = "dGFwLTAwMDAwMDAwMDAwMQ";
const ID2 = "dGFwLTAwMDAwMDAwMDAwMg";
const RUN2 = "Q2xhc3NSdW4tMDAwMDAwMg";
const running = recorded("following-locked");
const manual = variant(running, { link: { mode: "manual", state: "manual", canUndo: false, announcement: null }, allowed: ["pause", "skip", "nudge"] });

describe("companion session: states", () => {
  it("a state with a lower or equal seq in the same run is ignored", () => {
    const l = connected(variant(running, { seq: 41 }));
    assert.equal(step(l, stateMsg(variant(running, { seq: 40, now: { ...running.now, cue: "old" } }), 2000)).state?.now.cue, running.now.cue);
    assert.equal(step(l, stateMsg(variant(running, { seq: 41, now: { ...running.now, cue: "same" } }), 2000)).state?.now.cue, running.now.cue);
    const newer = step(l, stateMsg(variant(running, { seq: 42, now: { ...running.now, cue: "new" } }), 2000));
    assert.equal(newer.state?.now.cue, "new");
    assert.equal(newer.stateAt, 2000);
  });

  it("a new run replaces everything shown, even with a lower seq", () => {
    let l = connected(manual);
    const p = press(l, "pause", ID, 1100);
    assert.ok(p);
    l = p.live;
    const fresh = step(l, stateMsg(variant(recorded("not-started"), { run: RUN2 }), 1200));
    assert.equal(fresh.state?.run, RUN2);
    assert.equal(fresh.state?.seq, 0);
    assert.deepEqual(fresh.pending, []);
    assert.equal(fresh.note, null);
    assert.equal(fresh.notice, null);
  });

  it("live only while open, welcomed, the computer in and the state at most 3 s old", () => {
    const l = connected(running, 1000);
    assert.ok(isLive(l, 4000));
    assert.ok(!isLive(l, 4001));
    assert.ok(!isLive(step(l, msg({ type: "host_status", connected: false }, 1500)), 1500));
    assert.ok(!isLive(step(l, { type: "closed", code: 1006, at: 1500 }), 1500));
    assert.ok(!isLive(startLive(), 0));
  });
});

describe("companion session: a press", () => {
  it("sends only an allowed action, with the state's run and seq as its basis", () => {
    const l = connected(running);
    assert.equal(press(l, "nudge", ID, 1100, 5000), null, "nudge is not allowed while following");
    assert.equal(press(l, "resume", ID, 1100), null);
    const p = press(l, "pause", ID, 1100);
    assert.deepEqual(p?.command, { id: ID, run: running.run, basis: running.seq, action: "pause" });
    assert.ok(p && isSending(p.live, "pause"));
  });

  it("a nudge carries exactly its delta; a delta on anything else is refused", () => {
    const l = connected(manual);
    assert.deepEqual(press(l, "nudge", ID, 1100, -5000)?.command.deltaMs, -5000);
    assert.equal(press(l, "nudge", ID, 1100), null);
    assert.equal(press(l, "pause", ID, 1100, 5000), null);
  });

  it("nothing is sent when not live, after the end, or while the same key is sending", () => {
    const l = connected(manual, 1000);
    assert.equal(press(l, "pause", ID, 5000), null, "state too old");
    assert.equal(press(step(l, msg({ type: "host_status", connected: false }, 1100)), "pause", ID, 1100), null);
    assert.equal(press(connected(variant(manual, { status: "ended", allowed: [] })), "pause", ID, 1100), null);
    const p = press(l, "pause", ID, 1100);
    assert.ok(p);
    assert.equal(press(p.live, "pause", ID2, 1200), null);
    assert.ok(press(p.live, "skip", ID2, 1200), "another key is not blocked");
  });

  it("applied: the note for 3 s, the key back from Sending", () => {
    const p = press(connected(manual), "skip", ID, 1100);
    assert.ok(p);
    const l = step(p.live, msg({ type: "ack", id: ID, result: "applied", reason: null }, 1300));
    assert.deepEqual(l.pending, []);
    assert.equal(l.note?.kind, "done");
    assert.equal(step(l, { type: "tick", at: 1300 + NOTE_MS }).note, null);
  });

  it("a later state ends Sending before the ack", () => {
    const p = press(connected(manual), "pause", ID, 1100);
    assert.ok(p);
    const l = step(p.live, stateMsg(variant(manual, { seq: manual.seq + 1 }), 1200));
    assert.ok(!isSending(l, "pause"));
    assert.equal(l.pending.length, 1, "still waiting for its ack");
  });

  it("refused: the notice with the reason's words for 4 s", () => {
    for (const reason of ACK_REASONS) {
      const p = press(connected(manual), "pause", ID, 1100);
      assert.ok(p);
      const l = step(p.live, msg({ type: "ack", id: ID, result: "refused", reason }, 1200));
      assert.equal(l.notice?.kind, "refused");
      assert.ok(l.notice && flashNotice(l.notice) === REFUSAL_WORDS[reason], reason);
      assert.equal(step(l, { type: "tick", at: 1200 + NOTICE_MS }).notice, null);
    }
  });

  it("no ack in 3 s: No answer; a late ack still shows its answer; an unknown id is ignored", () => {
    const p = press(connected(manual), "pause", ID, 1100);
    assert.ok(p);
    let l = step(p.live, { type: "tick", at: 1100 + ACK_WITHIN_MS - 1 });
    assert.equal(l.pending.length, 1);
    l = step(l, { type: "tick", at: 1100 + ACK_WITHIN_MS });
    assert.deepEqual(l.pending, []);
    assert.ok(l.notice && flashNotice(l.notice) === NO_ANSWER);
    assert.equal(step(l, msg({ type: "ack", id: ID2, result: "applied", reason: null }, 4200)), l);
    const late = step(l, msg({ type: "ack", id: ID, result: "applied", reason: null }, 4300));
    assert.equal(late.note?.kind, "done");
    assert.equal(late.notice, null);
  });

  it("a dropped connection clears what was pending: nothing is queued for later", () => {
    const p = press(connected(manual), "pause", ID, 1100);
    assert.ok(p);
    const l = step(p.live, { type: "closed", code: 1006, at: 1200 });
    assert.equal(l.conn, "down");
    assert.deepEqual(l.pending, []);
  });
});

describe("companion session: the end", () => {
  it("4401 (token refused), 4403 (ended) and 4409 (replaced) end the session", () => {
    for (const code of [CLOSE_REFUSED, CLOSE_ENDED, CLOSE_REPLACED]) assert.equal(step(connected(running), { type: "closed", code, at: 1500 }).gone, "ended", String(code));
    for (const code of [1000, 1006, 1008, 1009, 1011]) assert.equal(step(connected(running), { type: "closed", code, at: 1500 }).gone, null, String(code));
  });

  it("ended dropped is Control ended; every other reason is Session ended; nothing changes it after", () => {
    const dropped = step(connected(running), msg({ type: "ended", reason: "dropped" }, 1500));
    assert.equal(dropped.gone, "dropped");
    for (const reason of ["host_ended", "revoked", "expired"] as const) assert.equal(step(connected(running), msg({ type: "ended", reason }, 1500)).gone, "ended");
    const after: Live = step(dropped, stateMsg(variant(running, { seq: 99 }), 1600));
    assert.equal(after, dropped);
  });
});
