// The host's command intake (issue #172, ADR 0005 section 5): the check order, ids keyed by slot,
// the run, the basis, staleness, `allowed`, `would_stop_following`, and the mapping of every
// action to a ClockCommand. Pure; fakes only.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClockCommand } from "../../src/core/commands.ts";
import { COMPANION_ACTIONS, toClockCommand } from "../../src/core/live/actions.ts";
import type { CompanionAction } from "../../src/core/live/actions.ts";
import { parseForwardedCommand } from "../../src/core/live/forwarded.ts";
import { DEFAULT_INTAKE_CONFIG, intake, newIntake, recordPublished, REMEMBERED_COMMANDS } from "../../src/core/live/intake.ts";
import type { IntakeOutcome } from "../../src/core/live/intake.ts";
import type { PlayerState } from "../../src/core/player-state.ts";
import { companionStateOf } from "../../src/core/live/companion-state.ts";
import { following, forwarded, id, loaded, NOW, OTHER_RUN, published, RUN, undoable, validCommandResult } from "./live-rig.ts";

// Type test: the intake hands on a ClockCommand or nothing, never anything else.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const intakeGivesClockCommand: Exact<IntakeOutcome["command"], ClockCommand | null> = true;
const mappingGivesClockCommand: Exact<ReturnType<typeof toClockCommand>, ClockCommand | null> = true;
void intakeGivesClockCommand;
void mappingGivesClockCommand;

const MAPPING: readonly [CompanionAction, number | undefined, ClockCommand][] = [
  ["start", undefined, { type: "start" }],
  ["pause", undefined, { type: "pause" }],
  ["resume", undefined, { type: "resume" }],
  ["skip", undefined, { type: "next" }],
  ["nudge", 5000, { type: "jump", deltaMs: 5000 }],
  ["nudge", -5000, { type: "jump", deltaMs: -5000 }],
  ["undo_resync", undefined, { type: "undo" }],
];

test("every action maps to exactly its player command", () => {
  for (const [action, delta, cmd] of MAPPING) assert.deepEqual(toClockCommand(action, delta), cmd, action);
  assert.deepEqual(new Set(MAPPING.map(([a]) => a)), new Set(COMPANION_ACTIONS));
});

test("a nudge needs exactly plus or minus 5000 ms, and nothing else takes a delta", () => {
  for (const d of [undefined, 0, 1000, 4999, 5001, -10_000, 5000.5]) assert.equal(toClockCommand("nudge", d), null, String(d));
  for (const a of COMPANION_ACTIONS.filter((x) => x !== "nudge")) assert.equal(toClockCommand(a, 5000), null, a);
});

test("the forwarded command is checked again: anything not exactly its shape is dropped", () => {
  assert.notEqual(parseForwardedCommand(forwarded("pause")), null);
  const bad: Record<string, unknown>[] = [
    forwarded("pause", { slot: 3 }),
    forwarded("pause", { slot: "1" }),
    forwarded("pause", { v: 2 }),
    forwarded("pause", { type: "ack" }),
    forwarded("pause", { id: "short" }),
    forwarded("pause", { run: "x".repeat(23) }),
    forwarded("pause", { basis: -1 }),
    forwarded("pause", { basis: 1.5 }),
    forwarded("pause", { action: "previous" }),
    forwarded("pause", { action: "manual" }),
    forwarded("pause", { action: "follow" }),
    forwarded("pause", { deltaMs: 5000 }),
    forwarded("nudge", { deltaMs: 10_000 }),
    forwarded("pause", { resistance: 3 }),
    forwarded("pause", { extra: true }),
  ];
  const noSlot = forwarded("pause");
  delete noSlot.slot;
  bad.push(noSlot);
  for (const m of bad) assert.equal(parseForwardedCommand(m), null, JSON.stringify(m));
  const s = loaded(following("Locked"));
  for (const m of [...bad, null, "pause", [], 7]) {
    const out = intake(published(s, true), s, m, NOW, true);
    assert.equal(out.result, null);
    assert.equal(out.command, null);
  }
});

const s = loaded({ mode: "manual", state: "Manual" }, "running");

test("a command on the current state is applied, and the answer matches the contract", () => {
  const out = intake(published(s, true), s, forwarded("pause"), NOW, true);
  assert.deepEqual(out.result, { v: 1, type: "command_result", slot: 1, id: id(1), result: "applied", reason: null });
  assert.deepEqual(out.command, { type: "pause" });
  assert.ok(validCommandResult(out.result), JSON.stringify(validCommandResult.errors));
});

test("check 1: a (slot, id) already seen is answered duplicate, even when it is now late or refused", () => {
  const first = intake(published(s, true), s, forwarded("pause"), NOW, true);
  const again = intake(first.memory, s, forwarded("pause"), NOW + 60_000, true);
  assert.deepEqual(again.result, { v: 1, type: "command_result", slot: 1, id: id(1), result: "duplicate", reason: null });
  assert.equal(again.command, null);
  const refused = intake(first.memory, s, forwarded("start", { id: id(2) }), NOW, true);
  assert.equal(refused.result?.result, "refused");
  assert.equal(intake(refused.memory, s, forwarded("start", { id: id(2) }), NOW, true).result?.result, "duplicate");
  const late = intake(first.memory, s, forwarded("pause", { id: id(3), run: OTHER_RUN }), NOW, true);
  assert.equal(intake(late.memory, s, forwarded("pause", { id: id(3), run: OTHER_RUN }), NOW, true).result?.result, "duplicate", "comes before the run check");
});

test("check 1 is keyed by slot: one phone's id never answers for the other's", () => {
  const first = intake(published(s, true), s, forwarded("pause"), NOW, true);
  const other = intake(first.memory, s, forwarded("pause", { slot: 2 }), NOW, true);
  assert.equal(other.result?.result, "applied");
  assert.equal(other.result?.slot, 2);
});

test("check 1 remembers the run's last 64 commands", () => {
  let m = published(s, true);
  for (let i = 0; i <= REMEMBERED_COMMANDS; i++) m = intake(m, s, forwarded("pause", { id: id(i) }), NOW, true).memory;
  assert.equal(m.recent.length, REMEMBERED_COMMANDS);
  assert.equal(intake(m, s, forwarded("pause", { id: id(REMEMBERED_COMMANDS) }), NOW, true).result?.result, "duplicate");
  assert.equal(intake(m, s, forwarded("pause", { id: id(0) }), NOW, true).result?.result, "applied", "the 65th oldest is forgotten");
});

const refusedFor = (out: IntakeOutcome) => [out.result?.result, out.result?.reason, out.command];

test("check 2: another run is stale_run", () => {
  assert.deepEqual(refusedFor(intake(published(s, true), s, forwarded("pause", { run: OTHER_RUN }), NOW, true)), ["refused", "stale_run", null]);
});

test("check 3: a basis above the current seq is invalid, and so is any basis before a state is published", () => {
  assert.deepEqual(refusedFor(intake(published(s, true, 4), s, forwarded("pause", { basis: 5 }), NOW, true)), ["refused", "invalid", null]);
  assert.deepEqual(refusedFor(intake(newIntake(RUN), s, forwarded("pause"), NOW, true)), ["refused", "invalid", null]);
});

test("check 4: a basis published more than 3 s ago is stale; 3 s exactly is not", () => {
  const m = published(s, true);
  assert.equal(DEFAULT_INTAKE_CONFIG.staleMs, 3000);
  assert.equal(intake(m, s, forwarded("pause"), NOW + 3000, true).result?.result, "applied");
  assert.deepEqual(refusedFor(intake(m, s, forwarded("pause"), NOW + 3001, true)), ["refused", "stale", null]);
  assert.deepEqual(refusedFor(intake(m, s, forwarded("pause"), NOW + 1001, true, { staleMs: 1000 })), ["refused", "stale", null], "a setting");
});

test("check 4 looks at the basis, not the latest state: an older basis still fresh is fine, a forgotten one is stale", () => {
  const st = (seq: number) => companionStateOf(s, NOW, true, RUN, seq)!;
  let m = recordPublished(published(s, true, 0, NOW - 3500), st(1), NOW - 2000);
  m = recordPublished(m, st(2), NOW);
  assert.equal(intake(m, s, forwarded("pause", { basis: 1 }), NOW, true).result?.result, "applied");
  assert.deepEqual(refusedFor(intake(m, s, forwarded("pause", { basis: 0 }), NOW, true)), ["refused", "stale", null]);
});

test("a state of another run, or an old seq, is not recorded", () => {
  const m = published(s, true, 3);
  assert.equal(recordPublished(m, companionStateOf(s, NOW, true, OTHER_RUN, 9)!, NOW), m);
  assert.equal(recordPublished(m, companionStateOf(s, NOW, true, RUN, 3)!, NOW), m);
});

test("check 5: an action not in the last published allowed is not_allowed", () => {
  const m = published(s, true, 0, NOW, ["resume"]);
  assert.deepEqual(refusedFor(intake(m, s, forwarded("pause"), NOW, true)), ["refused", "not_allowed", null]);
});

test("check 6: a route that became a handover after the state is would_stop_following", () => {
  const locked = loaded(following("Locked"));
  // Published while the music app could be sent the pause; the transport is gone at the tap.
  const m = published(locked, true);
  assert.ok(m.published[0].allowed.includes("pause"));
  assert.deepEqual(refusedFor(intake(m, locked, forwarded("pause"), NOW, false)), ["refused", "would_stop_following", null]);
});

test("the order: stale_run before invalid before stale before not_allowed before would_stop_following", () => {
  const locked = loaded(following("Locked"));
  const m = published(locked, true, 0, NOW, ["start"]);
  const r = (over: Record<string, unknown>, now = NOW) => intake(m, locked, forwarded("pause", over), now, false).result?.reason;
  assert.equal(r({ run: OTHER_RUN, basis: 9 }, NOW + 10_000), "stale_run");
  assert.equal(r({ basis: 9 }, NOW + 10_000), "invalid");
  assert.equal(r({}, NOW + 10_000), "stale");
  assert.equal(r({}), "not_allowed");
  const all = published(locked, true, 0, NOW, ["pause"]);
  assert.equal(intake(all, locked, forwarded("pause"), NOW, false).result?.reason, "would_stop_following");
});

// Published on one state, tapped on a changed one (review of #177, B1 and N1).
const manualRunning = loaded({ mode: "manual", state: "Manual" }, "running");

test("a nudge published on the manual clock is refused once the clock follows the music again, in any link state", () => {
  const m = published(manualRunning, true);
  assert.ok(m.published[0].allowed.includes("nudge"));
  const changed: readonly [string, PlayerState][] = [
    ["Follow picked, not locked yet", loaded({ mode: "following", state: "Manual", everLocked: false }, "running")],
    ["Coasting", loaded(following("Coasting"), "running")],
    ["Off the list", loaded(following("Off the list"), "running")],
    ["Locked", loaded(following("Locked"), "running")],
  ];
  for (const [name, now] of changed) {
    for (const deltaMs of [5000, -5000]) {
      for (const canSend of [true, false]) {
        const out = intake(m, now, forwarded("nudge", { deltaMs }), NOW + 500, canSend);
        assert.equal(out.result?.result, "refused", name);
        assert.ok(out.result?.reason === "not_allowed" || out.result?.reason === "would_stop_following", `${name}: ${out.result?.reason}`);
        assert.equal(out.command, null, name);
      }
    }
  }
  assert.equal(intake(m, changed[1][1], forwarded("nudge"), NOW + 500, true).result?.reason, "not_allowed", "coasting: no handover, just not offered");
  assert.equal(intake(m, changed[3][1], forwarded("nudge"), NOW + 500, true).result?.reason, "would_stop_following", "locked: the route is a handover");
});

test("an undo published while it could be undone is refused once its window has closed, and applied just before", () => {
  const s = loaded(undoable({ undo: { clockMs: 90_000, at: NOW - 29_000, until: NOW + 1000 } }), "running");
  const m = published(s, true);
  assert.ok(m.published[0].allowed.includes("undo_resync"));
  assert.equal(intake(m, s, forwarded("undo_resync"), NOW + 1000, true).result?.result, "applied");
  assert.deepEqual(refusedFor(intake(m, s, forwarded("undo_resync", { id: id(2) }), NOW + 1001, true)), ["refused", "not_allowed", null]);
  const gone = loaded(following("Locked"), "running");
  assert.deepEqual(refusedFor(intake(m, gone, forwarded("undo_resync", { id: id(3) }), NOW, true)), ["refused", "not_allowed", null], "or once it was superseded");
});

test("an action that does nothing by the time it arrives is refused, not applied (start after the presenter started)", () => {
  const ready = loaded({ mode: "manual", state: "Manual" }, "ready");
  const m = published(ready, true);
  assert.ok(m.published[0].allowed.includes("start"));
  assert.deepEqual(refusedFor(intake(m, manualRunning, forwarded("start"), NOW + 200, true)), ["refused", "not_allowed", null]);
  assert.deepEqual(refusedFor(intake(published(manualRunning, true), loaded({ mode: "manual", state: "Manual" }, "paused"), forwarded("pause"), NOW, true)), ["refused", "not_allowed", null]);
});

test("a route that became a handover is still would_stop_following, ahead of not_allowed", () => {
  const m = published(loaded(following("Paused"), "paused"), true);
  assert.ok(m.published[0].allowed.includes("resume"));
  assert.equal(intake(m, loaded(following("Paused"), "paused"), forwarded("resume"), NOW, false).result?.reason, "would_stop_following");
});
