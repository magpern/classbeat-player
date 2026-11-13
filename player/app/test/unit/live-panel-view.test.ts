// The presenter's phone-remote view (core/live/panel-view.ts): what each phase shows, the control
// code only live and with a second display and only until it runs out, the phones' places with
// Drop, the "Phone 1: pause" line, and never the host token or the session id.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { lineText, livePanelView } from "../../src/core/live/panel-view.ts";
import type { PanelFacts } from "../../src/core/live/panel-view.ts";
import { OFF } from "../../src/core/live/session-types.ts";
import type { LiveModel } from "../../src/core/live/session-types.ts";
import { RUN } from "./live-rig.ts";

const TOKEN = `cbp_hst_${randomBytes(32).toString("base64url")}`;
const SESSION_ID = "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b";
const LIVE: LiveModel = {
  ...OFF,
  phase: "live",
  run: RUN,
  session: { sessionId: SESSION_ID, joinCode: "BCDF-GHJK", hostToken: TOKEN },
  socket: 1,
  sockets: 1,
  places: ["connected", "away"],
  code: { code: "QRST-VWXZ", expiresAt: 120_000 },
  line: { slot: 1, action: "pause", deltaMs: null, until: 5000 },
};
const FACTS: PanelFacts = { now: 1000, classOpen: true, secondDisplay: true, origin: "https://player.example.test" };

test("live, with a second display: both codes, the places with Drop, the line", () => {
  const v = livePanelView(LIVE, FACTS);
  assert.equal(v.status, "On");
  assert.equal(v.classCode, "BCDF-GHJK");
  assert.equal(v.controlCode, "QRST-VWXZ");
  assert.equal(v.controlCodeLeft, "1:59");
  assert.equal(v.controlPage, "https://player.example.test/control");
  assert.deepEqual(v.slots, [
    { slot: 1, text: "Phone 1: steering", canDrop: true },
    { slot: 2, text: "Phone 2: not connected", canDrop: true },
  ]);
  assert.equal(v.line, "Phone 1: pause");
  assert.equal(v.canEnd, true);
  assert.equal(v.canStart, false);
  assert.equal(v.canMakeCode, false);
});

test("the view never holds the host token, the session id or the run", () => {
  for (const phase of ["idle", "starting", "connecting", "live", "reconnecting", "ended", "refused"] as const) {
    const text = JSON.stringify(livePanelView({ ...LIVE, phase }, FACTS));
    for (const secret of [TOKEN, SESSION_ID, RUN, "cbp_"]) assert.ok(!text.includes(secret), `${phase}: ${secret}`);
  }
});

test("one display: no control code, not even one already made; sign-in only", () => {
  const v = livePanelView(LIVE, { ...FACTS, secondDisplay: false });
  assert.equal(v.controlCode, null);
  assert.equal(v.canMakeCode, false);
  assert.match(v.detail ?? "", /A control code needs a second display/);
  assert.equal(v.classCode, "BCDF-GHJK");
});

test("the control code goes when it runs out, and only shows while live", () => {
  assert.equal(livePanelView(LIVE, { ...FACTS, now: 120_000 }).controlCode, null);
  assert.equal(livePanelView(LIVE, { ...FACTS, now: 120_000 }).canMakeCode, true);
  for (const phase of ["reconnecting", "ended", "connecting"] as const) assert.equal(livePanelView({ ...LIVE, phase }, FACTS).controlCode, null, phase);
});

test("a cancelled code says why", () => {
  const v = livePanelView({ ...LIVE, code: null, codeNote: "wrong_tries" }, FACTS);
  assert.equal(v.codeNote, "Control code cancelled after 5 wrong tries");
});

test("off: shown with a class open, Start offered; hidden with no class", () => {
  assert.equal(livePanelView(OFF, FACTS).canStart, true);
  assert.equal(livePanelView(OFF, FACTS).shown, true);
  assert.equal(livePanelView(OFF, { ...FACTS, classOpen: false }).shown, false);
  assert.deepEqual(livePanelView(OFF, FACTS).slots, []);
});

test("ended and refused say why and offer a new start; reconnecting says the class goes on", () => {
  const ended = livePanelView({ ...OFF, phase: "ended", ended: "gone" }, FACTS);
  assert.equal(ended.status, "Ended");
  assert.equal(ended.canStart, true);
  assert.equal(ended.classCode, null);
  assert.equal(livePanelView({ ...OFF, phase: "refused", refusal: "not_paired" }, FACTS).detail, "Pair this computer to use a phone remote");
  const away = livePanelView({ ...LIVE, phase: "reconnecting" }, FACTS);
  assert.equal(away.status, "Reconnecting");
  assert.match(away.detail ?? "", /^The class goes on/);
  assert.ok(away.slots.every((s) => !s.canDrop));
});

test("the line names the phone and what it did, in the presenter's words", () => {
  const at = (action: Parameters<typeof lineText>[0]["action"], deltaMs: number | null = null) => lineText({ slot: 2, action, deltaMs, until: 0 });
  assert.deepEqual(
    [at("start"), at("pause"), at("resume"), at("skip"), at("nudge", 5000), at("nudge", -5000), at("undo_resync")],
    ["Phone 2: start", "Phone 2: pause", "Phone 2: resume", "Phone 2: skip", "Phone 2: forward 5 s", "Phone 2: back 5 s", "Phone 2: undo"],
  );
  assert.equal(livePanelView(LIVE, { ...FACTS, now: 5000 }).line, null);
});

test("End is offered while starting, and Start is not (#203)", () => {
  const v = livePanelView({ ...OFF, phase: "starting" }, FACTS);
  assert.equal(v.status, "Starting…");
  assert.equal(v.canEnd, true);
  assert.equal(v.canStart, false);
  assert.equal(v.classCode, null);
  for (const phase of ["idle", "ended", "refused"] as const) assert.equal(livePanelView({ ...OFF, phase }, FACTS).canEnd, false, phase);
});
