// The local cue and report as they cross between the shell and the room window, the play URL's one
// shape, and the mode policy of a local class (ADR 0017 section 3). Pure.
import assert from "node:assert/strict";
import { test } from "node:test";
import { modePolicy } from "../../src/core/mix/mode-policy.ts";
import { linkPlanFrom } from "../../src/core/link/plan.ts";
import { localCueOf, parseLocalCue, parseLocalReport } from "../../src/core/music-files/local-cue.ts";
import { localModePolicy, missingWords } from "../../src/core/music-files/local-mode-policy.ts";
import type { LocalModeInput } from "../../src/core/music-files/local-mode-policy.ts";
import { LOCAL_SCHEME_PRIVILEGES, localPlayIdOf, localPlayUrl } from "../../src/core/music-files/local-scheme-policy.ts";
import { loadExample } from "./fixtures.ts";

const ID = "0123456789abcdef0123456789abcdef";
const URL_OK = `cbp-local://play/${ID}`;
const fade = { inToMs: 0, outFromMs: 1_000, stopMs: 2_000 };
const cue = () => ({ seq: 3, playing: true, slots: [{ url: URL_OK, positionMs: 500, fade: { ...fade } }, { url: null, positionMs: 0, fade: { inToMs: 0, outFromMs: 0, stopMs: 0 } }] });

test("the play URL names a 128-bit id and nothing else; the scheme's privileges are exactly four", () => {
  assert.equal(localPlayUrl(ID), URL_OK);
  assert.equal(localPlayIdOf(URL_OK), ID);
  for (const bad of ["ABCDEF".padEnd(32, "0"), "0".repeat(31), "../x", ""]) assert.throws(() => localPlayUrl(bad), RangeError, bad);
  for (const bad of [`${URL_OK}?x=1`, `${URL_OK}#a`, `cbp-local://play:1/${ID}`, `cbp-local://play/${ID}/x`, `cbp-local://play/${ID.toUpperCase()}`, `cbp-mix://play/${ID}`, `cbp-local://file/${ID}`, 7, null]) {
    assert.equal(localPlayIdOf(bad), null, String(bad));
  }
  assert.deepEqual(Object.keys(LOCAL_SCHEME_PRIVILEGES).sort(), ["secure", "standard", "stream", "supportFetchAPI"]);
  assert.ok(Object.isFrozen(LOCAL_SCHEME_PRIVILEGES));
});

test("a cue parses only in exactly the shape the shell sends; a copy carries those fields only", () => {
  assert.deepEqual(parseLocalCue(cue()), cue());
  const bad: Array<(c: ReturnType<typeof cue>) => unknown> = [
    (c) => ({ ...c, extra: 1 }),
    (c) => ({ ...c, seq: -1 }),
    (c) => ({ ...c, seq: 1.5 }),
    (c) => ({ ...c, playing: "yes" }),
    (c) => ({ ...c, slots: [c.slots[0]] }),
    (c) => ({ ...c, slots: { 0: c.slots[0], 1: c.slots[1], length: 2 } }),
    (c) => ({ ...c, slots: [{ ...c.slots[0], url: "file:///home/me/Music/a.mp3" }, c.slots[1]] }),
    (c) => ({ ...c, slots: [{ ...c.slots[0], url: `cbp-mix://play/${ID}` }, c.slots[1]] }),
    (c) => ({ ...c, slots: [{ ...c.slots[0], path: "/x" }, c.slots[1]] }),
    (c) => ({ ...c, slots: [{ ...c.slots[0], positionMs: Number.POSITIVE_INFINITY }, c.slots[1]] }),
    (c) => ({ ...c, slots: [{ ...c.slots[0], fade: { ...fade, outFromMs: 3_000 } }, c.slots[1]] }),
    (c) => ({ ...c, slots: [{ ...c.slots[0], fade: { ...fade, inToMs: -1 } }, c.slots[1]] }),
    (c) => Object.assign(Object.create({ evil: 1 }), c),
  ];
  for (const [i, f] of bad.entries()) assert.equal(parseLocalCue(f(cue())), null, String(i));
  const wide = { ...cue(), sha256: "a".repeat(64), slots: [{ ...cue().slots[0], file: "x" }, cue().slots[1]] } as unknown as Parameters<typeof localCueOf>[0];
  assert.deepEqual(localCueOf(wide), cue());
});

test("a report parses only as its six fields, each of its type and range", () => {
  const r = { seq: 3, slot: 1, positionMs: 1_234.6, playing: true, failed: false, durationMs: 210_000.4 };
  assert.deepEqual(parseLocalReport(r), { ...r, positionMs: 1_235, durationMs: 210_000 });
  assert.deepEqual(parseLocalReport({ ...r, durationMs: null }), { ...r, positionMs: 1_235, durationMs: null });
  for (const bad of [{ ...r, seq: 0 }, { ...r, slot: 2 }, { ...r, slot: "0" }, { ...r, positionMs: -1 }, { ...r, durationMs: Number.NaN }, { ...r, failed: 1 }, { ...r, path: "x" }, [r], null]) {
    assert.equal(parseLocalReport(bad), null, JSON.stringify(bad));
  }
});

const BASE: LocalModeInput = { musicSource: "local", songs: 3, check: { status: "done", songs: ["found", "found", "found"], limit_reached: false }, wrongLength: new Set() };

test("a local class plays only with every song found and checked; one missing is the manual clock", () => {
  assert.deepEqual(localModePolicy(BASE), { mode: "local" });
  assert.deepEqual(localModePolicy({ ...BASE, check: { status: "done", songs: ["found", "missing", "found"], limit_reached: false } }), { mode: "manual", reason: "missing", missing: [1] });
  assert.deepEqual(localModePolicy({ ...BASE, wrongLength: new Set([2]) }), { mode: "manual", reason: "missing", missing: [2] });
  for (const check of [null, { status: "cancelled" } as const, { status: "failed" } as const, { status: "done", songs: ["found", "found"], limit_reached: false } as const]) {
    assert.deepEqual(localModePolicy({ ...BASE, check }), { mode: "manual", reason: "not_checked" }, JSON.stringify(check));
  }
  assert.deepEqual(localModePolicy({ ...BASE, songs: 0, check: { status: "done", songs: [], limit_reached: false } }), { mode: "manual", reason: "not_checked" });
  assert.equal(missingWords(1), "1 music file is missing");
  assert.equal(missingWords(2), "2 music files are missing");
});

test("spotify, swedebeat and none never use local playback; a local class never uses the mix or the Spotify link", () => {
  for (const musicSource of ["spotify", "swedebeat", "none"] as const) assert.deepEqual(localModePolicy({ ...BASE, musicSource }), { mode: "not_local" }, musicSource);
  const mixReady = { hasMix: true, sourceAvailable: true, keychainUsable: true, hasToken: true, readiness: "ready" } as const;
  assert.deepEqual(modePolicy({ ...mixReady, musicSource: "local" }), { mode: "not_mix" });
  const doc = loadExample("valid/class-45min-crossfade-9s.json");
  assert.equal(linkPlanFrom(doc).manualOnly, false);
  assert.equal(linkPlanFrom({ ...doc, music: { ...doc.music, source: "local" } } as typeof doc).manualOnly, true);
});
