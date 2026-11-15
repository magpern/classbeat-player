// Whether Start loads the class playlist and whether the load is confirmed (issue #488, ADR 0001
// "Start loads the class playlist"): the pure decision and confirm logic, with the fake loader.
import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmLoad, fallsBack, loadAnswered, loadAtStart, NO_LOAD, PLAYLIST_CONFIRM_MS, playlistNotLoaded } from "../../src/core/link/playlist-load.ts";
import type { PlaylistLoad, StartFacts } from "../../src/core/link/playlist-load.ts";
import { canLoadPlaylist, createFakeLoader, isPlaylistId, PLAYLIST_URI_PREFIX, playlistUri } from "../../src/core/link/playlist.ts";
import type { LoadOutcome } from "../../src/core/link/playlist.ts";
import type { Observation } from "../../src/core/link/types.ts";
import { makePlan, track } from "./link-harness.ts";

const ID = "37i9dQZF1DXcBWIGoYBM5M";
const plan = makePlan(["A", "B", "C"]);
const GO: StartFacts = { isStart: true, playlist: ID, atZero: true, toMusic: true, canLoad: true };
const reading = (name: string, at: number, seenAt = at): Observation => ({ ...track(name), positionMs: 0, playing: true, at, seenAt });
const asking = (now: number): PlaylistLoad => loadAtStart(NO_LOAD, GO, now).load;

test("the id is 22 letters or digits, and the link is only the fixed prefix plus that id", () => {
  assert.equal(PLAYLIST_URI_PREFIX, "spotify:playlist:");
  assert.equal(playlistUri(ID), `spotify:playlist:${ID}`);
  for (const bad of [`${ID.slice(0, 21)}"`, `${ID.slice(0, 21)} `, `${ID.slice(0, 21)}:`, `${ID.slice(0, 21)}\n`, `${ID}\n`, `${ID}x`, ID.slice(1), "", `spotify:playlist:${ID}`, `https://open.example/${ID}`, 22, null, undefined, [ID], { id: ID }]) {
    assert.equal(isPlaylistId(bad), false, JSON.stringify(bad));
    assert.equal(playlistUri(bad), null, JSON.stringify(bad));
  }
});

test("Start at class time 0 of a class with a playlist asks for it, and nothing else does", () => {
  assert.deepEqual(loadAtStart(NO_LOAD, GO, 1000), { load: { kind: "asking", until: 1000 + PLAYLIST_CONFIRM_MS }, ask: ID });
  // Not Start (pause, next, a nudge, resume), or Start after a jump or a chosen start: nothing asked, nothing said.
  for (const f of [{ ...GO, isStart: false }, { ...GO, atZero: false }]) assert.deepEqual(loadAtStart(NO_LOAD, f, 1000), { load: NO_LOAD, ask: null });
  // A later Start keeps what the first one found.
  const confirmed: PlaylistLoad = { kind: "confirmed" };
  assert.equal(loadAtStart(confirmed, { ...GO, atZero: false }, 9000).load, confirmed);
});

test("a class without a playlist says nothing new, wherever Start goes", () => {
  for (const f of [GO, { ...GO, toMusic: false }, { ...GO, canLoad: false }]) {
    const r = loadAtStart(NO_LOAD, { ...f, playlist: undefined }, 1000);
    assert.deepEqual(r, { load: NO_LOAD, ask: null });
    assert.equal(playlistNotLoaded(r.load), false);
  }
});

test("a playlist that cannot be loaded (no follower that loads, the manual clock, a bad id) is not loaded, and said so", () => {
  for (const f of [{ ...GO, canLoad: false }, { ...GO, toMusic: false }, { ...GO, playlist: `${ID.slice(0, 21)}"` }, { ...GO, playlist: 7 }]) {
    const r = loadAtStart(NO_LOAD, f, 1000);
    assert.equal(r.ask, null, JSON.stringify(f));
    assert.equal(playlistNotLoaded(r.load), true, JSON.stringify(f));
  }
});

test("the follower's answer: taken means confirming, anything else is not loaded and falls back to play", () => {
  const a = asking(1000);
  assert.deepEqual(loadAnswered(a, "asked", 1400), { kind: "confirming", from: 1400, until: 1400 + PLAYLIST_CONFIRM_MS });
  assert.equal(fallsBack(a, "asked"), false);
  for (const o of ["failed", "not-running", "unsupported"] as LoadOutcome[]) {
    assert.equal(playlistNotLoaded(loadAnswered(a, o, 1400)), true, o);
    assert.equal(fallsBack(a, o), true, o);
  }
  // A late answer, once decided, changes nothing. A late failure after the window still falls back to play (#494).
  for (const decided of [NO_LOAD, { kind: "confirmed" }, { kind: "not-loaded" }] as PlaylistLoad[]) {
    assert.equal(loadAnswered(decided, "asked", 2000), decided);
    assert.equal(fallsBack(decided, "failed"), decided.kind === "not-loaded");
    assert.equal(fallsBack(decided, "asked"), false);
  }
});

test(`confirmed when the first fresh reading matches song 1 within ${PLAYLIST_CONFIRM_MS} ms`, () => {
  const c = loadAnswered(asking(1000), "asked", 1500);
  assert.deepEqual(confirmLoad(c, plan, reading("A", 1750), 1750), { kind: "confirmed" });
  assert.deepEqual(confirmLoad(c, plan, reading("A", 1500 + PLAYLIST_CONFIRM_MS), 1500 + PLAYLIST_CONFIRM_MS), { kind: "confirmed" }, "the last moment of the window");
  // The first fresh reading is not song 1 (shuffle on, an edited playlist): not loaded.
  assert.equal(playlistNotLoaded(confirmLoad(c, plan, reading("B", 1750), 1750)), true);
  assert.equal(playlistNotLoaded(confirmLoad(c, plan, { ...reading("A", 1750), app: "Another player" }, 1750)), true, "another app playing is not song 1");
});

test("only a fresh reading decides: one from before the load was taken, or gone stale, does not", () => {
  const c = loadAnswered(asking(1000), "asked", 1500);
  assert.equal(confirmLoad(c, plan, reading("B", 1499, 1499), 1600), c, "dated before Spotify took the load");
  assert.equal(confirmLoad(c, plan, null, 1600), c, "no reading yet");
  assert.equal(confirmLoad(c, plan, reading("A", 1600, 1600), 1600 + 2600), c, "a reading gone stale (rule 8)");
  assert.equal(confirmLoad(confirmLoad(c, plan, reading("A", 1600, 1600), 1600 + 2600), plan, reading("A", 4000), 4000).kind, "confirmed");
});

test("no fresh reading in time, or no answer in time, means not loaded", () => {
  const c = loadAnswered(asking(1000), "asked", 1500);
  const end = 1500 + PLAYLIST_CONFIRM_MS;
  assert.equal(confirmLoad(c, plan, null, end), c);
  assert.equal(playlistNotLoaded(confirmLoad(c, plan, null, end + 1)), true);
  assert.equal(playlistNotLoaded(confirmLoad(c, plan, reading("A", end + 1), end + 1)), true, "a reading of song 1 after the window is too late");
  const a = asking(1000);
  assert.equal(confirmLoad(a, plan, reading("A", 1200), 1000 + PLAYLIST_CONFIRM_MS), a, "no answer yet, within the window");
  assert.equal(playlistNotLoaded(confirmLoad(a, plan, reading("A", 1200), 1001 + PLAYLIST_CONFIRM_MS)), true);
  // Decided states stay as they are.
  for (const d of [NO_LOAD, { kind: "confirmed" }, { kind: "not-loaded" }] as PlaylistLoad[]) assert.equal(confirmLoad(d, plan, reading("B", 9000), 9000), d);
});

test("the fake records each request, loads nothing, and answers as told", () => {
  const fake = createFakeLoader();
  assert.equal(canLoadPlaylist(fake), true);
  for (const no of [null, undefined, {}, { loadPlaylist: 1 }, "x"]) assert.equal(canLoadPlaylist(no), false);
  const got: LoadOutcome[] = [];
  fake.loadPlaylist(ID, (o) => got.push(o));
  fake.outcome = "asked";
  fake.loadPlaylist(ID, (o) => got.push(o));
  assert.deepEqual(fake.requests, [ID, ID]);
  assert.deepEqual(got, ["unsupported", "asked"]);
});
