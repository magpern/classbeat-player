// Where the band's buttons send their presses (core/room/band-routes.ts): the same routing as the
// presenter's commands (`routeWhileFollowing`), told to the room window as one of three closed values.
import assert from "node:assert/strict";
import { test } from "node:test";
import { initialLink, routeWhileFollowing } from "../../src/core/link/index.ts";
import type { LinkModel, LinkStateName } from "../../src/core/link/index.ts";
import { bandRoutes, bandRoutesOf } from "../../src/core/room/band-routes.ts";
import type { BandRoutes } from "../../src/core/room/band-routes.ts";

const STATES: readonly LinkStateName[] = ["Locked", "Paused", "Ambiguous", "Coasting", "Off the list", "Manual"];
const linked = (state: LinkStateName, over: Partial<LinkModel> = {}): LinkModel => ({ ...initialLink(true), state, everLocked: true, ...over });
const ALL = (r: "music" | "clock" | "handover"): BandRoutes => ({ start: r, pause: r, resume: r, next: r, previous: r });

test("locked and able to send: start, pause, resume and next ask the music; previous hands the clock over", () => {
  assert.deepEqual(bandRoutes(linked("Locked"), true, true), { start: "music", pause: "music", resume: "music", next: "music", previous: "handover" });
});

test("locked with no way to send: every press hands the clock over", () => {
  assert.deepEqual(bandRoutes(linked("Locked"), true, false), ALL("handover"));
});

test("manual, no reader, coasting or off the list: every press moves the clock", () => {
  assert.deepEqual(bandRoutes(linked("Locked", { mode: "manual" }), true, true), ALL("clock"));
  assert.deepEqual(bandRoutes(linked("Locked"), false, true), ALL("clock"));
  assert.deepEqual(bandRoutes(linked("Coasting"), true, true), ALL("clock"));
  assert.deepEqual(bandRoutes(linked("Off the list"), true, true), ALL("clock"));
});

test("before the first lock Start asks the music and starts the clock: named for the clock", () => {
  assert.deepEqual(bandRoutes(linked("Locked", { everLocked: false }), true, true), ALL("clock"));
});

test("for every link state, mode and transport, each route agrees with routeWhileFollowing", () => {
  for (const state of STATES) for (const mode of ["following", "manual"] as const) for (const everLocked of [true, false]) for (const available of [true, false]) for (const canSend of [true, false]) {
    const link = linked(state, { mode, everLocked });
    const routes = bandRoutes(link, available, canSend);
    for (const type of ["start", "pause", "resume", "next", "previous"] as const) {
      const r = routeWhileFollowing(link, available, { type }, canSend);
      const expected = r === null || (r.kind === "transport" && r.alsoClock === true) ? "clock" : r.kind === "manual" ? "handover" : "music";
      assert.equal(routes[type], expected, `${state} ${mode} ${everLocked} ${available} ${canSend} ${type}`);
    }
  }
});

test("what the room window is sent: closed values only, nothing else carried", () => {
  assert.equal(bandRoutesOf(null), null);
  const hostile = { start: "music", pause: "x", resume: 3, next: { a: 1 }, previous: "handover", extra: "leak" } as unknown as BandRoutes;
  assert.deepEqual(bandRoutesOf(hostile), { start: "music", pause: "clock", resume: "clock", next: "clock", previous: "handover" });
  assert.equal(bandRoutesOf("music" as unknown as BandRoutes), null);
});
