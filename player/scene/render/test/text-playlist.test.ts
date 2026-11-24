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
import type { LinkInput } from "../../model/src/index.ts";

const input = (link: LinkInput, playlistNotLoaded: boolean) => ({ cls: DEMO_TEXT, classMs: 5000, songIndex: 0, songPosMs: 5000, link, reducedMotion: false, aspect: 16 / 9, playlistNotLoaded });

test("while the music is followed the plate says so, white, and hides the segment name", () => {
  const on = textView(input({ state: "Locked" }, true));
  assert.deepEqual(on.rail.link, { text: "Playlist not loaded", alert: true });
  assert.equal(on.rail.segment, null);
  const off = textView(input({ state: "Locked" }, false));
  assert.deepEqual(off.rail.link, { text: "Following Spotify", alert: false });
});

test("never in place of a link fault, a held link or the manual clock", () => {
  for (const state of ["Paused", "Coasting", "Off the list", "Ambiguous"] as const) {
    assert.equal(linkWords({ state }, DEMO_TEXT, true).text, linkWords({ state }, DEMO_TEXT, false).text, state);
  }
  assert.equal(linkWords({ state: "Locked", held: true }, DEMO_TEXT, true).text, "Until the next song");
  assert.equal(linkWords({ state: "Manual" }, DEMO_TEXT, true).text, "Manual clock");
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
