// The room screen's phone-remote slot from the live session (issue #202; room-2d.md, "The slot's
// states"): one row per phase, refusal and ending, and whatever else the session holds (the host
// token, the session id, the control code, the run) never in it. Pure; no fakes needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { roomSlotOf } from "../../src/core/live/room-slot.ts";
import type { SlotFacts } from "../../src/core/live/room-slot.ts";
import { OFF } from "../../src/core/live/session-types.ts";
import type { EndReason, LiveModel, Phase, Refusal } from "../../src/core/live/session-types.ts";
import { remoteViewOf } from "../../src/core/room/remote.ts";
import type { RemoteView } from "../../src/core/room/remote.ts";
import { CONTROL_CODE, HOST_TOKEN, JOIN_CODE, ORIGIN, SESSION_ID } from "./live-relay.ts";

const RUN = "RUNRUNRUNRUNRUNRUNRUNR";
const FACTS: SlotFacts = { paired: true, classOpen: true, site: ORIGIN };

/** A session holding everything it can: the token, the id, a control code, both places, a line. */
const full = (phase: Phase, over: Partial<LiveModel> = {}): LiveModel => ({
  ...OFF,
  phase,
  run: RUN,
  session: { sessionId: SESSION_ID, joinCode: JOIN_CODE, hostToken: HOST_TOKEN },
  places: ["connected", "away"],
  code: { code: CONTROL_CODE, expiresAt: 999_999 },
  codeNote: "used",
  line: { slot: 1, action: "pause", deltaMs: null, until: 999_999 },
  ...over,
});

const ON = (phones: 0 | 1 | 2, reconnecting = false): RemoteView => ({ slot: "on", joinCode: JOIN_CODE, phones, reconnecting, site: ORIGIN });

test("each phase gives the spec's state: Off, Starting, On and Reconnecting", () => {
  const rows: readonly [string, LiveModel, RemoteView][] = [
    ["idle", OFF, { slot: "available", note: "none" }],
    ["starting", { ...OFF, phase: "starting", run: RUN }, { slot: "starting" }],
    ["connecting: the code is not shown yet", full("connecting", { places: ["none", "none"] }), { slot: "starting" }],
    ["live, no phone", full("live", { places: ["none", "none"] }), ON(0)],
    ["live, a phone connected and one away", full("live"), ON(1)],
    ["live, two phones", full("live", { places: ["connected", "connected"] }), ON(2)],
    ["reconnecting: the code stays", full("reconnecting", { places: ["away", "away"] }), ON(0, true)],
  ];
  for (const [label, m, want] of rows) assert.deepEqual(roomSlotOf(m, FACTS), want, label);
});

test("refusals: in use elsewhere is said; no answer and a broken pairing take the slot away; the rest can be tried again", () => {
  const want: Readonly<Record<Refusal, RemoteView>> = {
    sessions_full: { slot: "available", note: "in_use" },
    unreachable: { slot: "absent" },
    not_paired: { slot: "absent" },
    pair_again: { slot: "absent" },
    too_many: { slot: "available", note: "none" },
    server: { slot: "available", note: "none" },
    no_class: { slot: "available", note: "none" },
  };
  for (const [refusal, v] of Object.entries(want)) assert.deepEqual(roomSlotOf({ ...OFF, phase: "refused", refusal: refusal as Refusal }, FACTS), v, refusal);
});

test("endings: Phone remote ended, except for a new class, which starts Off", () => {
  const reasons: readonly EndReason[] = ["host_ended", "revoked", "expired", "lost", "gone", "replaced"];
  for (const ended of reasons) assert.deepEqual(roomSlotOf({ ...OFF, phase: "ended", ended }, FACTS), { slot: "available", note: "ended" }, ended);
  assert.deepEqual(roomSlotOf({ ...OFF, phase: "ended", ended: "class_changed" }, FACTS), { slot: "available", note: "none" });
});

test("not paired: absent in every phase; no class open: no button to press", () => {
  const phases: readonly Phase[] = ["idle", "starting", "connecting", "live", "reconnecting", "ended", "refused"];
  for (const p of phases) assert.deepEqual(roomSlotOf(full(p), { ...FACTS, paired: false }), { slot: "absent" }, p);
  for (const m of [OFF, { ...OFF, phase: "ended" as const, ended: "host_ended" as const }, { ...OFF, phase: "refused" as const, refusal: "server" as const }]) {
    assert.deepEqual(roomSlotOf(m, { ...FACTS, classOpen: false }), { slot: "absent" }, m.phase);
  }
});

test("the site goes with the code only as the room's filter allows: HTTPS origins, nothing else", () => {
  assert.deepEqual(roomSlotOf(full("live"), { ...FACTS, site: null }), { slot: "on", joinCode: JOIN_CODE, phones: 1, reconnecting: false });
  for (const site of ["http://127.0.0.1:5000", "https://x.test/path", "javascript:alert(1)"]) {
    assert.deepEqual(remoteViewOf(roomSlotOf(full("live"), { ...FACTS, site })), { slot: "on", joinCode: JOIN_CODE, phones: 1, reconnecting: false }, site);
  }
});

test("isolation: no phase, refusal or ending puts the host token, the session id, the control code or the run in the slot", () => {
  const phases: readonly Phase[] = ["idle", "starting", "connecting", "live", "reconnecting", "ended", "refused"];
  const allowed = new Set(["slot", "note", "joinCode", "phones", "reconnecting", "site"]);
  for (const p of phases) {
    for (const facts of [FACTS, { ...FACTS, site: null }, { ...FACTS, classOpen: false }]) {
      const v = roomSlotOf(full(p, { refusal: "sessions_full", ended: "host_ended" }), facts);
      for (const k of Object.keys(v)) assert.ok(allowed.has(k), `${p}: ${k}`);
      const text = JSON.stringify(v);
      for (const secret of [HOST_TOKEN, SESSION_ID, CONTROL_CODE, CONTROL_CODE.replace("-", ""), RUN, "cbp_"]) assert.ok(!text.includes(secret), `${p}: ${secret}`);
    }
  }
});
