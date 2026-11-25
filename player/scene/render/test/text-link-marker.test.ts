// The link marker's shape per state (scene.md "Link markers in the text layer", room-2d.md States): round while following, square for the manual states and the
// "Playlist not loaded" plate. The layer puts `sq` on the square ones and the stylesheet squares the marker.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEMO_TEXT } from "../demo/demo-text.ts";
import { textView } from "../src/text-view-calc.ts";
import type { TextLink } from "../src/text-types.ts";

const marker = (link: TextLink, playlistNotLoaded = false) => {
  const v = textView({ cls: DEMO_TEXT, classMs: 5000, songIndex: 0, songPosMs: 5000, link, reducedMotion: false, aspect: 16 / 9, playlistNotLoaded });
  return [v.rail.link.text, v.rail.kind];
};

test("Following Spotify has a round dot", () => {
  assert.deepEqual(marker({ state: "Locked", mode: "following" }), ["Following Spotify", "round"]);
});

test("the manual states and the playlist plate have a square", () => {
  assert.deepEqual(marker({ state: "Manual", mode: "manual" }), ["Manual clock", "square"]);
  assert.deepEqual(marker({ state: "Manual", mode: "manual", started: false }), ["Press Start", "square"]);
  assert.deepEqual(marker({ state: "Manual", mode: "manual", announcement: true }), ["Following stopped", "square"]);
  assert.deepEqual(marker({ state: "Manual", mode: "manual", available: true }), ["Manual · F to follow", "square"]);
  assert.deepEqual(marker({ state: "Locked", mode: "following" }, true), ["Playlist not loaded", "square"]);
});

test("a fault plate stays a square, and the stylesheet draws the shapes", () => {
  assert.deepEqual(marker({ state: "Paused", mode: "following" }), ["Music paused", "square"]);
  const css = readFileSync(new URL("../layer/text.css", import.meta.url), "utf8");
  assert.match(css, /#text \.link::before \{[^}]*border-radius: 50%/);
  assert.match(css, /#text \.link\.sq::before \{ border-radius: 0; \}/);
  const layer = readFileSync(new URL("../layer/text-layer.ts", import.meta.url), "utf8");
  assert.match(layer, /rail\.kind === "square"/);
});
