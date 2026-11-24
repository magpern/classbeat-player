// The mode policy over every case of ADR 0013 section 4 and docs/design/swedebeat.md's reasons.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { modePolicy, reasonWords, REASON_WORDS, SHORT_REASON_WORDS } from "../../src/core/mix/mode-policy.ts";
import type { FallbackReason, MixReadiness, ModeInput, ModeResult } from "../../src/core/mix/mode-policy.ts";

const BASE: ModeInput = { musicSource: "swedebeat", hasMix: true, sourceAvailable: true, keychainUsable: true, hasToken: true, readiness: "ready" };
const manual = (reason: FallbackReason): ModeResult => ({ mode: "manual", reason });
const NOT_MIX: ModeResult = { mode: "not_mix" };
const MIX: ModeResult = { mode: "mix" };

const cases: ReadonlyArray<readonly [string, Partial<ModeInput>, ModeResult]> = [
  ["every condition holds, mix cached", {}, MIX],
  ["partly cached, the sound has what it needs", { readiness: "streaming" }, MIX],
  ["unavailable source", { sourceAvailable: false }, manual("disabled")],
  ["unavailable source beats a missing keychain and token", { sourceAvailable: false, keychainUsable: false, hasToken: false }, manual("disabled")],
  ["no usable keychain", { keychainUsable: false }, manual("no_keychain")],
  ["no keychain beats no token", { keychainUsable: false, hasToken: false }, manual("no_keychain")],
  ["no token (never connected, signed out, or the token went invalid)", { hasToken: false }, manual("not_connected")],
  ["no token, though the mix is cached, plays nothing", { hasToken: false, readiness: "ready" }, manual("not_connected")],
  ["the sound would catch up with the download", { readiness: "downloading" }, manual("downloading")],
  ["a chunk or the length failed its check", { readiness: "not_checked" }, manual("not_checked")],
  ["the account may not play it", { readiness: "not_allowed" }, manual("not_allowed")],
  ["a Swedebeat class with no mix named", { hasMix: false }, NOT_MIX],
  ["a Swedebeat class with no mix and no source", { hasMix: false, sourceAvailable: false }, NOT_MIX],
  ["a Spotify class", { musicSource: "spotify", hasMix: false }, NOT_MIX],
  ["a Spotify class, even with every mix condition and a mix named", { musicSource: "spotify" }, NOT_MIX],
  ["a soundless class, even with every mix condition and a mix named", { musicSource: "none" }, NOT_MIX],
];

describe("mode policy", () => {
  for (const [name, change, expected] of cases) {
    it(name, () => assert.deepEqual(modePolicy({ ...BASE, ...change }), expected));
  }

  it("covers every readiness with a token, source and keychain", () => {
    const all: MixReadiness[] = ["ready", "streaming", "downloading", "not_checked", "not_allowed"];
    const modes = all.map((readiness) => modePolicy({ ...BASE, readiness }).mode);
    assert.deepEqual(modes, ["mix", "mix", "manual", "manual", "manual"]);
  });

  it("gives every reason fixed plain words that name no code, host, path or token", () => {
    assert.deepEqual(Object.keys(REASON_WORDS).sort(), ["disabled", "downloading", "no_keychain", "not_allowed", "not_checked", "not_connected"]);
    assert.equal(REASON_WORDS.disabled, "Swedebeat playback is off");
    assert.equal(REASON_WORDS.not_connected, "Swedebeat is not connected");
    assert.equal(REASON_WORDS.downloading, "The mix is still downloading");
    assert.equal(REASON_WORDS.not_checked, "The mix could not be checked");
    for (const w of Object.values(REASON_WORDS)) assert.ok(!/[./\\:]|token|http|error/i.test(w), w);
  });

  it("has short forms only for the two reasons that can happen during a class", () => {
    assert.deepEqual(SHORT_REASON_WORDS, { downloading: "Mix still downloading", not_checked: "Mix not checked" });
  });

  it("words a result: the reason for a fall-back, nothing otherwise", () => {
    assert.equal(reasonWords(MIX), null);
    assert.equal(reasonWords(NOT_MIX), null);
    assert.equal(reasonWords(manual("disabled")), "Swedebeat playback is off");
  });
});
