// The rail's "Playlist not loaded" plate (room-2d.md, "Playlist not loaded"), driven by a fake frame
// source: the player decides the 30 s and sends `playlistNotLoaded` at the top level of the frame;
// the screen only reads it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toRoomModel } from "../../src/room/adapter.ts";
import { linkAt } from "../../src/fixtures/build.ts";
import { STATE_FIXTURES } from "../../src/fixtures/states.ts";
import type { LinkStateName, RoomInput } from "../../src/room/input.ts";

const running = STATE_FIXTURES.running;
const view = running.view;
if (!view) throw new Error("no view");

const frame = (playlistNotLoaded: boolean, state: LinkStateName = "Locked"): RoomInput => ({
  ...running,
  link: linkAt(view, state),
  playlistNotLoaded,
});
const rail = (i: RoomInput) => toRoomModel(i).rail.link;
const PLATE = { text: "Playlist not loaded", look: "alert" } as const;

describe("the playlist-not-loaded plate", () => {
  it("is a white plate with the square marker, 19 characters, while the frame says so", () => {
    assert.deepEqual(rail(frame(true)), PLATE);
    assert.equal(PLATE.text.length, 19);
  });

  it("returns the rail to its link state when the field clears", () => {
    assert.deepEqual(rail(frame(true)), PLATE);
    assert.deepEqual(rail(frame(false)), { text: "Following Spotify", look: "quiet" });
    assert.deepEqual(rail({ ...running, link: linkAt(view, "Locked") }), { text: "Following Spotify", look: "quiet" }, "absent counts as false");
  });

  it("takes the place of the quiet state only: a link fault stays", () => {
    const faults: readonly (readonly [LinkStateName, string])[] = [["Paused", "Music paused"], ["Coasting", "Music not heard"], ["Off the list", "Not a class song"], ["Ambiguous", "Song is in twice"]];
    for (const [state, text] of faults) assert.deepEqual(rail(frame(true, state)), { text, look: "alert" }, state);
  });

  it("reads the top-level field, never a field of the link", () => {
    const nested = { ...linkAt(view, "Locked"), playlistNotLoaded: true } as RoomInput["link"];
    assert.equal(rail({ ...running, link: nested, playlistNotLoaded: false })?.text, "Following Spotify");
  });

  it("moves nothing else on the rail or the screen", () => {
    const on = toRoomModel(frame(true));
    const off = toRoomModel(frame(false));
    assert.deepEqual({ ...on, rail: null }, { ...off, rail: null });
    assert.deepEqual([on.rail.left, on.rail.done, on.rail.segment], [off.rail.left, off.rail.done, off.rail.segment]);
  });
});
