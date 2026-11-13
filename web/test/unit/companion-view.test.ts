// What the phone shows at a moment (src/companion/core: clock, view, keys, hold) on recorded
// states: the countdown between messages, stale and lost, the keys and their guards.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countsAt, liveness } from "../../src/companion/core/clock.ts";
import { HOLD_MS, REDUCED_STEP_MS, SLIDE_PX, due, lifted, moved, progress, startHold } from "../../src/companion/core/hold.ts";
import { HOLD_HINT, KEYS_HOST_AWAY, KEYS_PHONE_AWAY, NOTHING_TO_STEER, NOT_FOLLOWING_HINT, SENDING, keysModel } from "../../src/companion/core/keys.ts";
import type { KeysModel } from "../../src/companion/core/keys.ts";
import { press, step } from "../../src/companion/core/session.ts";
import type { Live } from "../../src/companion/core/session.ts";
import { ACTIONS } from "../../src/companion/core/state-check.ts";
import { liveView } from "../../src/companion/core/view.ts";
import type { RunView } from "../../src/companion/core/view.ts";
import { connected, msg, recorded, variant } from "../lib/companion-states.ts";

const running = recorded("following-locked");
const manual = variant(running, { link: { mode: "manual", state: "manual", canUndo: false, announcement: null }, allowed: ["pause", "skip", "nudge"] });
const paused = recorded("manual-paused-last-interval");
const notStarted = recorded("not-started");

function run(l: Live, at: number): RunView {
  const v = liveView(l, at);
  assert.equal(v.kind, "run");
  return v as RunView;
}
const keysOf = (m: KeysModel) => (m.kind === "keys" ? m.keys : []);

describe("companion clock: between messages", () => {
  it("counts down from the state's moment, only while running", () => {
    const c = countsAt(running, 1000, 3500);
    assert.equal(c.remainingMs, running.now.remainingMs - 2500);
    assert.equal(c.classRemainingMs, running.classRemainingMs - 2500);
    assert.equal(c.toSongMs, (running.nextSong?.atMs ?? 0) - running.classMs - 2500);
    assert.equal(countsAt(paused, 1000, 9000).remainingMs, paused.now.remainingMs);
    assert.equal(countsAt(notStarted, 1000, 9000).remainingMs, notStarted.now.remainingMs);
  });

  it("runs on for at most 10 s and never under zero", () => {
    assert.equal(countsAt(running, 0, 60_000).remainingMs, running.now.remainingMs - 10_000);
    const short = variant(running, { now: { ...running.now, remainingMs: 2000 } });
    assert.equal(countsAt(short, 0, 5000).remainingMs, 0);
  });

  it("live for 3 s past the last state, Not live until 10 s, then lost", () => {
    const l = connected(running, 1000);
    assert.equal(liveness(l, 4000), "live");
    assert.equal(liveness(l, 4001), "not_live");
    assert.equal(liveness(l, 11_000), "not_live");
    assert.equal(liveness(l, 11_001), "lost");
  });
});

describe("companion view: states", () => {
  it("running: the interval countdown, the cue, the next rows and the song in time", () => {
    const v = run(connected(running, 1000), 2000);
    assert.equal(v.clock?.time, "0:45");
    assert.equal(v.clock?.label, "Interval left");
    assert.equal(v.cue, running.now.cue);
    assert.deepEqual(v.coming?.map((r) => r[0]), running.next.map((n) => n.zone.number));
    assert.match(v.clock?.song?.when ?? "", /^in \d+:\d\d$/);
    assert.equal(v.top.link?.text, "Following the music");
    assert.equal(v.gel.blank, false);
  });

  it("stale: Not live, dimmed, and the keys give way to a line", () => {
    const l = connected(manual, 1000);
    const v = run(l, 5000);
    assert.equal(v.clock?.label, "Not live");
    assert.equal(v.clock?.est, true);
    assert.deepEqual(v.keys, { kind: "msg", text: KEYS_HOST_AWAY });
    const down = run(step(l, { type: "closed", code: 1006, at: 2000 }), 2500);
    assert.equal(down.top.link?.text, "Reconnecting");
    assert.deepEqual(down.keys, { kind: "msg", text: KEYS_PHONE_AWAY });
    const away = run(step(l, msg({ type: "host_status", connected: false }, 2000)), 2500);
    assert.equal(away.top.link?.text, "Computer not connected");
  });

  it("lost after 10 s: the last zone, lights down, no countdown", () => {
    const v = liveView(step(connected(running, 1000), { type: "closed", code: 1006, at: 2000 }), 13_000);
    assert.deepEqual(v, { kind: "lost", phone: true, zone: { number: 4, name: "Threshold" }, lastSeen: "0:12" });
  });

  it("connecting until the first state; dropped and ended are their own pages", () => {
    assert.equal(liveView(step(connected(running), msg({ type: "ended", reason: "dropped" }, 1500)), 1500).kind, "dropped");
    assert.equal(liveView(step(connected(running), msg({ type: "ended", reason: "revoked" }, 1500)), 1500).kind, "ended");
  });

  it("before the start: First zone, First interval, First song at the start when it is", () => {
    const v = run(connected(variant(notStarted, { nextSong: { atMs: 0, title: "A", artist: "B" } })), 1500);
    assert.equal(v.gel.blank === false && v.gel.label, "First zone");
    assert.equal(v.clock?.label, "First interval");
    assert.equal(v.clock?.song?.label, "First song");
    assert.equal(v.clock?.song?.when, "at the start");
  });

  it("class complete: a blank gel and nothing more to steer", () => {
    const v = run(connected(variant(manual, { status: "ended", allowed: [] })), 1500);
    assert.equal(v.gel.blank && v.gel.name, "Class complete");
    assert.deepEqual(v.keys, { kind: "msg", text: NOTHING_TO_STEER });
  });

  it("estimated: coasting or off the list says so", () => {
    const v = run(connected(variant(running, { link: { mode: "following", state: "coasting", canUndo: false, announcement: null } })), 1500);
    assert.equal(v.clock?.label, "Interval left, estimated");
    assert.match(v.clock?.song?.when ?? "", /^in about /);
  });
});

describe("companion keys: the contract's six actions only (rule 2)", () => {
  const all = [running, manual, paused, notStarted, recorded("resync-announced")].map((s) => keysModel(connected(s), s, true));

  it("every key's action is one of the six, and a nudge carries exactly ±5000", () => {
    for (const m of all) {
      const ks = [...keysOf(m), ...(m.kind === "keys" && m.notice?.undo ? [m.notice.undo] : [])];
      for (const k of ks) {
        assert.ok(ACTIONS.includes(k.action), k.action);
        if (k.action === "nudge") assert.ok(k.deltaMs === 5000 || k.deltaMs === -5000);
        else assert.equal(k.deltaMs, undefined);
        assert.equal(k.hold, k.action === "start" || k.action === "resume" || k.action === "skip", `${k.action} hold`);
      }
    }
  });

  it("before the start, Start alone, held", () => {
    const ks = keysOf(keysModel(connected(notStarted), notStarted, true));
    assert.deepEqual(ks.map((k) => [k.action, k.hint]), [["start", HOLD_HINT]]);
  });

  it("while following, the nudges are greyed and say why; skip is Next song", () => {
    const ks = keysOf(keysModel(connected(running), running, true));
    const nudges = ks.filter((k) => k.action === "nudge");
    assert.equal(nudges.length, 2);
    for (const k of nudges) assert.deepEqual([k.live, k.hint], [false, NOT_FOLLOWING_HINT]);
    assert.equal(ks.find((k) => k.action === "skip")?.label, "Next song");
  });

  it("paused: Resume in the middle, held; a resync announcement takes skip's place with Undo", () => {
    const ks = keysOf(keysModel(connected(paused), paused, true));
    assert.equal(ks[1].action, "resume");
    const resync = recorded("resync-announced");
    const m = keysModel(connected(resync), resync, true);
    assert.ok(m.kind === "keys" && m.notice?.undo?.action === "undo_resync");
    assert.ok(m.kind === "keys" && !m.keys.some((k) => k.action === "skip"));
  });

  it("a pressed key reads Sending", () => {
    const l = connected(manual);
    const p = press(l, "pause", "dGFwLTAwMDAwMDAwMDAwMQ", 1100);
    assert.ok(p);
    assert.equal(keysOf(keysModel(p.live, manual, true)).find((k) => k.action === "pause")?.label, SENDING);
  });
});

describe("companion hold: 0.8 s to confirm, 16 px of slide", () => {
  const box = { left: 100, top: 100, right: 200, bottom: 164 };

  it("fires once at 0.8 s, not before", () => {
    const h = startHold(0, box);
    assert.equal(due(h, HOLD_MS - 1).fire, false);
    const r = due(h, HOLD_MS);
    assert.equal(r.fire, true);
    assert.equal(due(r.hold, HOLD_MS + 500).fire, false);
    assert.equal(lifted(r.hold), "fired");
  });

  it("a short tap is a short tap; sliding off the key cancels", () => {
    assert.equal(lifted(startHold(0, box)), "short");
    const inside = moved(startHold(0, box), 200 + SLIDE_PX, 164 + SLIDE_PX);
    assert.equal(inside.cancelled, false);
    const off = moved(startHold(0, box), 200 + SLIDE_PX + 1, 120);
    assert.equal(lifted(off), "cancelled");
    assert.equal(due(off, HOLD_MS * 2).fire, false);
  });

  it("the bar fills in steps with reduced motion", () => {
    const h = startHold(0, box);
    assert.equal(progress(h, 400, false), 0.5);
    assert.equal(progress(h, REDUCED_STEP_MS - 1, true), 0);
    assert.equal(progress(h, 2000, false), 1);
  });
});
