// The room's link line for a mix class (core/mix/mix-line.ts, docs/design/swedebeat.md "Room screen").
import assert from "node:assert/strict";
import { test } from "node:test";
import { FELL_BACK_SHOW_MS, mixLineOf } from "../../src/core/mix/mix-line.ts";

test("no mix class, no line", () => {
  assert.equal(mixLineOf(null, false, 0), null);
});

test("before the start: ready, downloading with a whole percent, or the full reason", () => {
  assert.deepEqual(mixLineOf({ kind: "ready" }, false, 0), { text: "Mix ready", shape: "dot" });
  assert.deepEqual(mixLineOf({ kind: "downloading", percent: 41.9 }, false, 0), { text: "Downloading the mix 41%", shape: "circle" });
  assert.deepEqual(mixLineOf({ kind: "downloading", percent: 140 }, false, 0), { text: "Downloading the mix 100%", shape: "circle" });
  assert.deepEqual(mixLineOf({ kind: "downloading", percent: Number.NaN }, false, 0), { text: "Downloading the mix 0%", shape: "circle" });
  assert.deepEqual(mixLineOf({ kind: "manual", reason: "not_connected", since: null }, false, 0), { text: "Press Start · Swedebeat is not connected", shape: "square" });
});

test("during the class: playing, or the short reason for 30 s after a fall back, then Manual clock", () => {
  assert.deepEqual(mixLineOf({ kind: "playing" }, true, 0), { text: "Playing the mix", shape: "dot" });
  const fell = { kind: "manual", reason: "downloading", since: 1_000 } as const;
  assert.deepEqual(mixLineOf(fell, true, 1_000), { text: "Mix still downloading", shape: "news" });
  assert.deepEqual(mixLineOf(fell, true, 1_000 + FELL_BACK_SHOW_MS - 1), { text: "Mix still downloading", shape: "news" });
  assert.deepEqual(mixLineOf(fell, true, 1_000 + FELL_BACK_SHOW_MS), { text: "Manual clock", shape: "square" });
  assert.deepEqual(mixLineOf({ kind: "manual", reason: "not_checked", since: 0 }, true, 0), { text: "Mix not checked", shape: "news" });
  assert.deepEqual(mixLineOf({ kind: "manual", reason: "not_connected", since: null }, true, 0), { text: "Manual clock", shape: "square" });
  assert.deepEqual(mixLineOf({ kind: "manual", reason: "not_allowed", since: 0 }, true, 0), { text: "Manual clock", shape: "square" }, "no short form");
});
