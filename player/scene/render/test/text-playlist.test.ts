// "Playlist not loaded" in the scene's text (scene.md, the states table): as the plain screen has it, a white plate in the link slot
// while the music is followed, never over a link fault, the segment name hidden, and a step of the text on a frame mark when it comes or goes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_TEXT } from "../demo/demo-text.ts";
import { feedAt } from "../demo/scenario.ts";
import type { Feed } from "../src/loop.ts";
import { TextClock } from "../src/text-clock.ts";
import { textView } from "../src/text-view-calc.ts";
import { linkWords } from "../src/text-words.ts";
import type { TextLink } from "../src/text-types.ts";

const input = (link: TextLink, playlistNotLoaded: boolean) => ({ cls: DEMO_TEXT, classMs: 5000, songIndex: 0, songPosMs: 5000, link, reducedMotion: false, aspect: 16 / 9, playlistNotLoaded });

test("while the music is followed the plate says so, white, and hides the segment name", () => {
  const on = textView(input({ state: "Locked", mode: "following" }, true));
  assert.deepEqual(on.rail.link, { text: "Playlist not loaded", alert: true });
  assert.equal(on.rail.segment, null);
  const off = textView(input({ state: "Locked", mode: "following" }, false));
  assert.deepEqual(off.rail.link, { text: "Following Spotify", alert: false });
});

test("in following mode the plate also takes the place of the wait for the first lock (state Manual) and the wait for Start", () => {
  assert.equal(linkWords({ state: "Manual", mode: "following" }, DEMO_TEXT, true).text, "Playlist not loaded");
  assert.equal(linkWords({ state: "Manual", mode: "following", started: false }, DEMO_TEXT, true).text, "Playlist not loaded");
  assert.equal(linkWords({ state: "Locked", mode: "following", started: false }, DEMO_TEXT, true).text, "Playlist not loaded");
});

test("never in place of a link fault, or the real manual clock", () => {
  for (const state of ["Paused", "Coasting", "Off the list", "Ambiguous"] as const) {
    const link = { state, mode: "following" } as const;
    assert.equal(linkWords(link, DEMO_TEXT, true).text, linkWords(link, DEMO_TEXT, false).text, state);
  }
  assert.equal(linkWords({ state: "Locked", mode: "following", held: true }, DEMO_TEXT, false).text, "Following Spotify", "a hold is the count's label, not the plate's words");
  assert.equal(linkWords({ state: "Manual", mode: "manual" }, DEMO_TEXT, true).text, "Manual clock");
  assert.equal(linkWords({ state: "Manual" }, DEMO_TEXT, true).text, "Manual clock", "a link with no mode is not followed");
});

/** Every state of web/src/room/link-text.ts (linkPlate, with no notice and no playlist notice), word for word, so the two surfaces agree. */
test("every link state says what the plain screen says", () => {
  const table: [string, TextLink, string][] = [
    ["following, Locked", { state: "Locked", mode: "following" }, "Following Spotify"],
    ["following, held at a song change", { state: "Locked", mode: "following", held: true }, "Following Spotify"],
    ["following, before the first lock", { state: "Manual", mode: "following" }, "Waiting for the first song"],
    ["following, before the start", { state: "Locked", mode: "following", started: false }, "Waiting for the first song"],
    ["following, before the start and the first lock", { state: "Manual", mode: "following", started: false }, "Waiting for the first song"],
    ["manual, before the start", { state: "Manual", mode: "manual", started: false }, "Press Start"],
    ["following, Paused", { state: "Paused", mode: "following" }, "Music paused"],
    ["following, Coasting", { state: "Coasting", mode: "following" }, "Music not heard"],
    ["following, Off the list", { state: "Off the list", mode: "following" }, "Not a class song"],
    ["following, Ambiguous", { state: "Ambiguous", mode: "following" }, "Song is in twice"],
    ["manual clock", { state: "Manual", mode: "manual" }, "Manual clock"],
    ["manual, the music could be followed", { state: "Manual", mode: "manual", available: true }, "Manual \u00b7 F to follow"],
    ["manual, hand-over announcement", { state: "Manual", mode: "manual", announcement: true, available: true }, "Following stopped"],
  ];
  for (const [what, link, words] of table) assert.equal(linkWords(link, DEMO_TEXT).text, words, what);
});

test("the text steps when the notice comes and goes, and only then", () => {
  const clock = new TextClock();
  const at = (ms: number, playlistNotLoaded: boolean): Feed => ({ ...feedAt(ms, { link: { state: "Locked" } }), playlistNotLoaded });
  clock.step(at(5000, false));
  let stepped = 0;
  let last = clock.step(at(5000, true));
  for (let ms = 5016; ms < 8000; ms += 16) {
    last = clock.step(at(ms, true));
    if (last.changed) stepped++;
  }
  assert.ok(stepped >= 1, "the notice is shown on a frame mark");
  assert.equal(last.playlistNotLoaded, true);
});
