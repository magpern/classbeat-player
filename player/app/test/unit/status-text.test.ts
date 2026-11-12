// The status line: a hold at a song window's end says holding, never paused (ADR 0001 rule 2).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClockView } from "../../src/core/clock/view.ts";
import type { LinkView } from "../../src/core/link/view.ts";
import { statusText } from "../../src/core/status-text.ts";

const clock = (over: Partial<ClockView>): ClockView => ({ status: "running", holding: false, ...over }) as ClockView;
const link = (over: Partial<LinkView>): LinkView => ({ mode: "following", held: false, ...over }) as LinkView;

test("held at a song window's end while following: holding, not paused", () => {
  assert.equal(statusText(clock({ status: "paused" }), link({ held: true })), "Holding at the end of the song");
});

test("a real pause keeps its word", () => {
  assert.equal(statusText(clock({ status: "paused" }), link({})), "paused");
  assert.equal(statusText(clock({ status: "paused" }), null), "paused");
});

test("the class end still says holding at the end", () => {
  assert.equal(statusText(clock({ status: "ended", holding: true }), null), "ended (holding at the end)");
});

test("a stale held flag in manual mode is ignored", () => {
  assert.equal(statusText(clock({ status: "paused" }), link({ mode: "manual", held: true })), "paused");
});
