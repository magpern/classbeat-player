// The link marker's shape per state (scene.md "Link markers in the text layer", room-2d.md States), decided from the link and mix state, as on the plain screen:
// round while following, square for the manual states, the "Playlist not loaded" plate and every white plate, a ring for a mix download.
// The real TextLayer runs on a fake document, so the class lands on the rendered marker element.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEMO_TEXT } from "../demo/demo-text.ts";
import { TextLayer } from "../layer/text-layer.ts";
import { textView } from "../src/text-view-calc.ts";
import type { TextLink } from "../src/text-types.ts";

const view = (link: TextLink, playlistNotLoaded = false) =>
  textView({ cls: DEMO_TEXT, classMs: 5000, songIndex: 0, songPosMs: 5000, link, reducedMotion: false, aspect: 16 / 9, playlistNotLoaded });
const marker = (link: TextLink, playlistNotLoaded = false) => { const v = view(link, playlistNotLoaded); return [v.rail.link.text, v.rail.kind]; };
const mix = (text: string, shape: "dot" | "circle" | "square" | "news"): TextLink => ({ state: "Locked", mode: "following", mix: { text, shape } });

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

test("a fault plate stays a square", () => {
  assert.deepEqual(marker({ state: "Paused", mode: "following" }), ["Music paused", "square"]);
});

test("a mix class's marker follows the line's shape (web/src/room/mix-words.ts)", () => {
  assert.deepEqual(marker(mix("Playing the mix", "dot")), ["Playing the mix", "round"]);
  assert.deepEqual(marker(mix("Mix ready", "dot")), ["Mix ready", "round"]);
  assert.deepEqual(marker(mix("Downloading the mix 40%", "circle")), ["Downloading the mix 40%", "ring"]);
  assert.deepEqual(marker(mix("Manual clock", "square")), ["Manual clock", "square"]);
  assert.deepEqual(marker(mix("Press Start · Swedebeat playback is off", "square")), ["Press Start · Swedebeat playback is off", "square"]);
  assert.deepEqual(marker(mix("Mix still downloading", "news")), ["Mix still downloading", "square"]);
});

/** A document of plain objects, enough for TextLayer's constructor and update. */
interface Fake { className: string; textContent: string; hidden: boolean; style: Record<string, string>; appendChild(c: Fake): void }
function fakeDocument(): Fake[] {
  const all: Fake[] = [];
  const el = (): Fake => { const e: Fake = { className: "", textContent: "", hidden: false, style: {}, appendChild() {} }; all.push(e); return e; };
  const root = el();
  (globalThis as unknown as { document: unknown }).document = { getElementById: () => root, createElement: el };
  return all;
}

test("the layer puts the shape's class on the rendered marker element", () => {
  const all = fakeDocument();
  const layer = new TextLayer();
  const classOf = (link: TextLink) => {
    layer.update(view(link));
    return all.filter((e) => /^link\b/.test(e.className)).map((e) => e.className);
  };
  assert.deepEqual(classOf({ state: "Locked", mode: "following" }), ["link ink"]);
  assert.deepEqual(classOf({ state: "Manual", mode: "manual" }), ["link ink sq"]);
  assert.deepEqual(classOf({ state: "Paused", mode: "following" }), ["link ink alert sq"]);
  assert.deepEqual(classOf(mix("Downloading the mix 40%", "circle")), ["link ink rg"]);
});

test("the stylesheet draws the shapes, at the plain screen's size", () => {
  const css = readFileSync(new URL("../layer/text.css", import.meta.url), "utf8");
  assert.match(css, /#text \.link::before \{[^}]*width: 1\.4vh; height: 1\.4vh; border-radius: 50%/);
  assert.match(css, /#text \.link\.sq::before \{ border-radius: 0; \}/);
  assert.match(css, /#text \.link\.rg::before \{ background: radial-gradient/);
  assert.match(css, /#text \.link\.alert::before \{[^}]*width: 1\.2vh; height: 1\.2vh/);
});
