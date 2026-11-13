// The rail after a hand-over (room-2d.md, "Back to following the music"), driven by a fake clock:
// the player keeps the announcement for 30 s and the frame carries it; the screen only reads it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toRoomModel } from "../../src/room/adapter.ts";
import { FOLLOW_NAMES, FIXTURES, STATE_NAMES, WORST_NAMES } from "../../src/fixtures/index.ts";
import { clockAt, linkAt } from "../../src/fixtures/build.ts";
import { STATE_FIXTURES } from "../../src/fixtures/states.ts";
import type { ClockInput, RoomInput } from "../../src/room/input.ts";

const UNDO_WINDOW_MS = 30_000;
const base = STATE_FIXTURES.running;
if (!base.view) throw new Error("no view");
const view: ClockInput = base.view;

/** A fake player: a clock the test moves, and the frames it would send. */
function fakePlayer(available = true) {
  let now = 0;
  let mode: "following" | "manual" = "following";
  let until = -1;
  return {
    advance(ms: number) { now += ms; },
    step() { mode = "manual"; until = now + UNDO_WINDOW_MS; },
    follow() { mode = "following"; until = -1; },
    frame(): RoomInput {
      const manual = mode === "manual";
      const announcement = manual && now <= until ? "manual clock: following stopped" : null;
      return { ...base, link: linkAt(view, manual ? "Manual" : "Locked", { mode, available, announcement }) };
    },
  };
}

const railOf = (p: { frame(): RoomInput }) => toRoomModel(p.frame()).rail.link;

describe("rail after a manual step", () => {
  it("says Following stopped for 30 s, then Manual · F to follow, until F is pressed", () => {
    const p = fakePlayer();
    assert.equal(railOf(p)?.text, "Following Spotify");
    p.step();
    assert.deepEqual(railOf(p), { text: "Following stopped", look: "manual", news: true });
    p.advance(29_999);
    assert.equal(railOf(p)?.text, "Following stopped");
    p.advance(1);
    assert.equal(railOf(p)?.text, "Following stopped"); // the 30th second is still inside
    p.advance(1);
    assert.deepEqual(railOf(p), { text: "Manual · F to follow", look: "manual" });
    p.advance(10 * 60_000);
    assert.equal(railOf(p)?.text, "Manual · F to follow");
  });

  it("F during the notice clears it at once, and after the notice clears the key hint", () => {
    const early = fakePlayer();
    early.step();
    early.advance(5_000);
    early.follow();
    assert.equal(railOf(early)?.text, "Following Spotify");
    const late = fakePlayer();
    late.step();
    late.advance(UNDO_WINDOW_MS + 1);
    late.follow();
    assert.equal(railOf(late)?.text, "Following Spotify");
  });

  it("a manual clock that cannot follow the music stays 'Manual clock', with no key named", () => {
    const p = fakePlayer(false);
    p.step();
    p.advance(UNDO_WINDOW_MS + 1);
    assert.deepEqual(railOf(p), { text: "Manual clock", look: "manual" });
  });

  it("before the start and at the end the old words stay", () => {
    const manual = (status: "ready" | "ended") => {
      const v = clockAt(base.doc!, status === "ready" ? 0 : 2_520_000, status);
      return toRoomModel({ ...base, view: v, link: linkAt(v, "Manual", { available: true }) }).rail.link?.text;
    };
    assert.equal(manual("ready"), "Press Start");
    assert.equal(manual("ended"), "Manual clock");
  });

  it("the rail holds only fixed words: nothing of the announcement's text reaches it", () => {
    const p = fakePlayer();
    p.step();
    const frame = p.frame();
    const odd = { ...frame, link: { ...frame.link!, announcement: "set resistance 90 for Rider Ann 214 W" } };
    assert.deepEqual(toRoomModel(odd).rail.link, { text: "Following stopped", look: "manual", news: true });
  });
});

describe("the hand-over fixtures", () => {
  it("are listed, show the two texts, and keep to fixed words and the plate look", () => {
    assert.deepEqual(FOLLOW_NAMES, ["handover", "manual-follow", "worst-handover", "worst-manual-follow"]);
    assert.ok(!STATE_NAMES.includes("handover") && !WORST_NAMES.includes("handover"));
    const texts = FOLLOW_NAMES.map((n) => toRoomModel(FIXTURES[n]).rail.link);
    assert.deepEqual(texts.map((t) => t?.text), ["Following stopped", "Manual · F to follow", "Following stopped", "Manual · F to follow"]);
    for (const t of texts) assert.equal(t?.look, "manual");
    assert.equal(toRoomModel(FIXTURES["worst-handover"]).rail.left, "1:58:58");
  });
});
