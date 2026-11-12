// The Next and Previous labels (issue 63): they come from the same routing as the commands, so for
// every link state the label says what the control does. Wording is provisional until the
// presenter design spec (#22, #31).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { controlLabels, initialLink, routeWhileFollowing } from "../../src/core/link/index.ts";
import type { LinkModel, LinkStateName, MusicReader, MusicTransport, Observation } from "../../src/core/link/index.ts";
import { createController } from "../../src/main/controller.ts";
import { converterExamples } from "./fixtures.ts";

const STATES: readonly LinkStateName[] = ["Locked", "Paused", "Ambiguous", "Coasting", "Off the list", "Manual"];
const linked = (state: LinkStateName, over: Partial<LinkModel> = {}): LinkModel => ({ ...initialLink(true), state, everLocked: true, ...over });

for (const state of ["Locked", "Paused", "Ambiguous"] as const) {
  test(`while ${state}: Next reads "Next song", Previous says it stops following`, () => {
    assert.deepEqual(controlLabels(linked(state), true, true), { next: "Next song", previous: "Previous interval (stops following)" });
  });
}

test("with no transport, Next hands the clock over and says so", () => {
  assert.deepEqual(controlLabels(linked("Locked"), true, false), { next: "Next interval (stops following)", previous: "Previous interval (stops following)" });
});

test("every other state keeps the interval labels", () => {
  const plain = { next: "Next interval", previous: "Previous interval" };
  for (const state of ["Coasting", "Off the list", "Manual"] as const) assert.deepEqual(controlLabels(linked(state), true, true), plain, state);
  assert.deepEqual(controlLabels(linked("Locked", { mode: "manual" }), true, true), plain, "manual mode");
  assert.deepEqual(controlLabels(linked("Locked"), false, true), plain, "no reader");
  assert.deepEqual(controlLabels(linked("Locked", { everLocked: false }), true, true), plain, "before the first lock the clock is the instructor's");
});

test("for every link state, mode and transport, the label agrees with the route", () => {
  for (const state of STATES) {
    for (const mode of ["following", "manual"] as const) {
      for (const everLocked of [true, false]) {
        for (const available of [true, false]) {
          for (const canSend of [true, false]) {
            const link = linked(state, { mode, everLocked });
            const l = controlLabels(link, available, canSend);
            const where = `${state} ${mode} locked=${everLocked} available=${available} send=${canSend}`;
            const next = routeWhileFollowing(link, available, { type: "next" }, canSend);
            const prev = routeWhileFollowing(link, available, { type: "previous" }, canSend);
            assert.equal(l.next === "Next song", next?.kind === "transport", `next song only when sent to the music: ${where}`);
            assert.equal(l.next.endsWith("(stops following)"), next?.kind === "manual", `next: ${where}`);
            assert.equal(l.next === "Next interval", next === null, `next: ${where}`);
            assert.equal(l.previous.endsWith("(stops following)"), prev?.kind === "manual", `previous: ${where}`);
            assert.equal(l.previous === "Previous interval", prev === null, `previous: ${where}`);
          }
        }
      }
    }
  }
});

const text = readFileSync(converterExamples()[0], "utf8");
const first = JSON.parse(text).songs[0] as { title: string; artist: string; length_ms: number };

test("the snapshot carries the labels: interval labels, then song labels once locked, then back after Manual", () => {
  const self = { t: 0, obs: null as Observation | null };
  const reader: MusicReader & MusicTransport = { kind: "fake", latest: () => self.obs, send: () => undefined };
  const c = createController(() => self.t, reader, reader);
  assert.equal(c.snapshot().controls, null, "no class open");
  c.open("a.json", text);
  assert.deepEqual(c.snapshot().controls, { next: "Next interval", previous: "Previous interval" });
  c.command({ type: "follow" });
  self.t = 1000;
  self.obs = { title: first.title, artist: first.artist, lengthMs: first.length_ms, positionMs: 5000, playing: true, at: self.t, seenAt: self.t };
  assert.deepEqual(c.snapshot().controls, { next: "Next song", previous: "Previous interval (stops following)" });
  assert.deepEqual(c.command({ type: "manual" }).controls, { next: "Next interval", previous: "Previous interval" });
});
