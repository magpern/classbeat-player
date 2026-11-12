// The instructor's clock controls while the link follows the music (issue 44): Pause, Resume and
// Next go to the music as named commands, previous and plus or minus 5 s switch to the manual clock
// with an announcement, and nothing is silently undone by the next tick.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ClockCommand } from "../../src/core/commands.ts";
import { HANDOVER_TEXT, initialLink, routeWhileFollowing } from "../../src/core/link/index.ts";
import type { LinkModel, LinkStateName, MusicReader, MusicTransport, Observation, TransportAction } from "../../src/core/link/index.ts";
import { createController } from "../../src/main/controller.ts";
import { advance, command, INITIAL, openText } from "../../src/core/player-state.ts";
import { classSchema, converterExamples } from "./fixtures.ts";

const linked = (state: LinkStateName, over: Partial<LinkModel> = {}): LinkModel => ({ ...initialLink(true), state, everLocked: true, ...over });

const TRANSPORT: readonly [ClockCommand, TransportAction][] = [
  [{ type: "pause" }, "pause"],
  [{ type: "resume" }, "play"],
  [{ type: "start" }, "play"],
  [{ type: "next" }, "next"],
];
const MOVES: readonly ClockCommand[] = [{ type: "previous" }, { type: "jump", deltaMs: 5000 }, { type: "jump", deltaMs: -5000 }];

for (const state of ["Locked", "Paused", "Ambiguous"] as const) {
  for (const [cmd, action] of TRANSPORT) {
    test(`while ${state}: ${cmd.type} goes to the music as "${action}"`, () => {
      assert.deepEqual(routeWhileFollowing(linked(state), true, cmd, true), { kind: "transport", action });
    });
  }
  for (const cmd of MOVES) {
    test(`while ${state}: ${JSON.stringify(cmd)} switches to the manual clock`, () => assert.deepEqual(routeWhileFollowing(linked(state), true, cmd, true), { kind: "manual" }));
  }
}

test("with no transport, a pause or next can only be done on the clock: manual", () => {
  for (const [cmd] of TRANSPORT) assert.deepEqual(routeWhileFollowing(linked("Locked"), true, cmd, false), { kind: "manual" });
});

test("not following: every control is the clock's own", () => {
  const all = [...TRANSPORT.map(([c]) => c), ...MOVES];
  for (const cmd of all) {
    assert.equal(routeWhileFollowing(linked("Coasting"), true, cmd, true), null, `coasting ${cmd.type}`);
    assert.equal(routeWhileFollowing(linked("Off the list"), true, cmd, true), null, `off the list ${cmd.type}`);
    assert.equal(routeWhileFollowing(linked("Manual"), true, cmd, true), null, `manual state ${cmd.type}`);
    assert.equal(routeWhileFollowing(linked("Locked", { mode: "manual" }), true, cmd, true), null, `manual mode ${cmd.type}`);
    if (cmd.type !== "start") assert.equal(routeWhileFollowing(linked("Locked", { everLocked: false }), true, cmd, true), null, `before the first lock ${cmd.type}`);
    assert.equal(routeWhileFollowing(linked("Locked"), false, cmd, true), null, `no reader ${cmd.type}`);
  }
  for (const state of ["Coasting", "Off the list", "Manual"] as const) assert.equal(routeWhileFollowing(linked(state), true, { type: "start" }, true), null, `start while ${state}`);
});

test("before the first lock, Start asks the music to play and also starts the clock", () => {
  const before = linked("Locked", { everLocked: false });
  assert.deepEqual(routeWhileFollowing(before, true, { type: "start" }, true), { kind: "transport", action: "play", alsoClock: true });
  assert.equal(routeWhileFollowing(before, true, { type: "start" }, false), null, "no transport: just the clock");
});

test("Start while following with no transport is done on the clock and goes manual", () => {
  assert.deepEqual(routeWhileFollowing(linked("Paused"), true, { type: "start" }, false), { kind: "manual" });
});

const text = readFileSync(converterExamples()[0], "utf8");
const first = JSON.parse(text).songs[0] as { title: string; artist: string; length_ms: number };

function rig(withTransport = true) {
  const sent: TransportAction[] = [];
  const self = { t: 0, obs: null as Observation | null };
  const reader: MusicReader & MusicTransport = {
    kind: "fake",
    latest: () => self.obs,
    send: (a) => void sent.push(a),
  };
  const c = createController(() => self.t, reader, withTransport ? reader : null);
  const reading = (positionMs: number, playing = true): void => {
    self.obs = { title: first.title, artist: first.artist, lengthMs: first.length_ms, positionMs, playing, at: self.t, seenAt: self.t };
  };
  c.open("a.json", text);
  c.command({ type: "follow" });
  self.t = 1000;
  reading(5000);
  assert.equal(c.snapshot().link?.state, "Locked");
  return { c, sent, self, reading };
}

test("Pause and Next while following go to the music, not the clock, and the clock follows the music", () => {
  const { c, sent, self, reading } = rig();
  const before = c.snapshot().view!.classMs;
  assert.equal(c.command({ type: "pause" }).view?.classMs, before);
  assert.equal(c.command({ type: "next" }).link?.mode, "following");
  assert.deepEqual(sent, ["pause", "next"]);
  assert.equal(c.snapshot().view?.status, "running", "the clock itself was not paused: only the music's answer does that");
  self.t = 1200;
  reading(5200, false);
  assert.equal(c.snapshot().link?.state, "Paused");
  assert.equal(c.snapshot().view?.status, "paused");
  c.command({ type: "resume" });
  assert.deepEqual(sent, ["pause", "next", "play"]);
});

for (const [cmd, label] of [
  [{ type: "jump", deltaMs: 5000 }, "+5 s"],
  [{ type: "jump", deltaMs: -5000 }, "-5 s"],
  [{ type: "previous" }, "previous"],
] as const) {
  test(`${label} while following switches to the manual clock, announced, and the next reading does not undo it`, () => {
    const { c, sent, self, reading } = rig();
    const before = c.snapshot().view!.classMs;
    const snap = c.command(cmd);
    assert.equal(snap.link?.mode, "manual");
    assert.equal(snap.link?.state, "Manual");
    assert.equal(snap.link?.announcement, HANDOVER_TEXT);
    assert.notEqual(snap.view?.classMs, before);
    const moved = snap.view!.classMs;
    self.t = 1500;
    reading(5500);
    const later = c.snapshot();
    assert.equal(later.link?.mode, "manual");
    assert.equal(later.view?.classMs, moved + 500, "the readings no longer move the clock");
    assert.deepEqual(sent, [], "nothing was sent to the music");
  });
}

test("Start while the music is paused goes to the music as play, and the clock follows the answer", () => {
  const { c, sent, self, reading } = rig();
  self.t = 1200;
  reading(5200, false);
  assert.equal(c.snapshot().view?.status, "paused");
  const snap = c.command({ type: "start" });
  assert.deepEqual(sent, ["play"]);
  assert.equal(snap.link?.mode, "following");
  assert.equal(snap.view?.status, "paused", "not started by itself");
  self.t = 1300;
  reading(5300, true);
  assert.equal(c.snapshot().view?.status, "running");
});

test("Start after Follow, before anything has played, asks the music to play and starts the clock", () => {
  const sent: TransportAction[] = [];
  const reader: MusicReader & MusicTransport = { kind: "fake", latest: () => null, send: (a) => void sent.push(a) };
  const c = createController(() => 0, reader, reader);
  c.open("a.json", text);
  c.command({ type: "follow" });
  const snap = c.command({ type: "start" });
  assert.deepEqual(sent, ["play"]);
  assert.equal(snap.view?.status, "running");
});

test("with no transport, Pause while following is done on the clock and goes manual", () => {
  const { c } = rig(false);
  const snap = c.command({ type: "pause" });
  assert.equal(snap.link?.mode, "manual");
  assert.equal(snap.view?.status, "paused");
  assert.equal(snap.link?.announcement, HANDOVER_TEXT);
});

test("a manual clock keeps its own controls: Pause and Next never reach the music", () => {
  const { c, sent } = rig();
  c.command({ type: "manual" });
  c.command({ type: "pause" });
  c.command({ type: "next" });
  assert.deepEqual(sent, []);
});

test("the state is not touched by a control that goes to the music", () => {
  let s = openText(INITIAL, "a.json", text, classSchema, 0, true);
  s = advance(s, 1000, { title: first.title, artist: first.artist, lengthMs: first.length_ms, positionMs: 5000, playing: true, at: 1000, seenAt: 1000 });
  for (const type of ["pause", "resume", "next"] as const) assert.equal(command(s, { type }, 1100, true), s, `${type} leaves the state as it is`);
  assert.notEqual(command(s, { type: "pause" }, 1100, false), s, "without a transport it is applied, as manual");
});
