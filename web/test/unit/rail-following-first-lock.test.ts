// The rail before the first lock (room-2d.md, "States"): a link that follows the music but has not
// locked yet arrives as state "Manual" in mode "following" and shows the quiet following text, not
// "Manual clock". The real manual clock (mode "manual") keeps its words.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toRoomModel } from "../../src/room/adapter.ts";
import { clockAt, linkAt } from "../../src/fixtures/build.ts";
import { STATE_FIXTURES } from "../../src/fixtures/states.ts";
import type { RoomInput } from "../../src/room/input.ts";

const running = STATE_FIXTURES.running;
const doc = running.doc as NonNullable<RoomInput["doc"]>;
const runningView = running.view;
if (!runningView) throw new Error("no view");

const rail = (status: "running" | "ready", mode: "following" | "manual", extra: Partial<RoomInput> = {}) => {
  const view = status === "ready" ? clockAt(doc, 0, "ready") : runningView;
  return toRoomModel({ doc, view, link: linkAt(view, "Manual", { mode, available: mode === "following" }), ...extra }).rail.link;
};
const QUIET = { text: "Waiting for the first song", look: "quiet" } as const;

describe("the rail before the first lock", () => {
  it("following, clock running: the quiet following text", () => assert.deepEqual(rail("running", "following"), QUIET));
  it("following, at the start: the quiet following text", () => assert.deepEqual(rail("ready", "following"), QUIET));
  it("manual, clock running: Manual clock", () => assert.deepEqual(rail("running", "manual"), { text: "Manual clock", look: "manual" }));
  it("manual, at the start: Press Start", () => assert.deepEqual(rail("ready", "manual"), { text: "Press Start", look: "manual" }));

  it("the playlist plate keeps its priority", () => {
    assert.equal(rail("running", "following", { playlistNotLoaded: true })?.text, "Playlist not loaded");
  });

  it("the room-checks fixture for the running clock uses the same words", () => {
    assert.deepEqual(toRoomModel(STATE_FIXTURES["following-before-lock"] as RoomInput).rail.link, QUIET);
  });
});
