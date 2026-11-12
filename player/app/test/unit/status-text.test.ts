// The status line: a hold at a song window's end says holding, never paused (ADR 0001 rule 2).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClockView } from "../../src/core/clock/view.ts";
import type { LinkView } from "../../src/core/link/view.ts";
import { statusText } from "../../src/core/status-text.ts";
import { classLength, makePlan, pauseAt, play, run } from "./link-harness.ts";

const clock = (over: Partial<ClockView>): ClockView => ({ status: "running", holding: false, ...over }) as ClockView;
const link = (over: Partial<LinkView>): LinkView => ({ mode: "following", state: "Locked", held: false, playing: true, ...over }) as LinkView;

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

test("music paused past the window end is a real pause", () => {
  assert.equal(statusText(clock({ status: "paused" }), link({ state: "Paused", held: true, playing: false })), "paused");
});

test("the last song held and the clock ended keeps the class-end text", () => {
  assert.equal(statusText(clock({ status: "ended", holding: true }), link({ held: true })), "ended (holding at the end)");
});

test("the issue's repro through the link: holding while the song plays past its window, paused when the music pauses", () => {
  const plan = makePlan(["A", "B", "C", "D"]);
  const t = run({ plan, segments: [play(1000, "A", 0), pauseAt(180_000, "A", 179_000)], until: 182_000 });
  const text = (now: number): string => {
    const r = t.at(now);
    return statusText(clock({ status: r.status, holding: r.classMs >= classLength(plan) }), r.view);
  };
  assert.equal(t.at(175_000).state, "Locked");
  assert.equal(t.at(175_000).view.held, true);
  assert.equal(text(175_000), "Holding at the end of the song");
  assert.equal(t.at(181_000).state, "Paused");
  assert.equal(text(181_000), "paused");
});

test("Ambiguous while held: holding when the music plays, paused when it does not", () => {
  const plan = makePlan(["A", "B", "C", "A", "D"]);
  // Song A twice in the class; played 4 s past the end of its first window.
  const t = run({ plan, segments: [play(1000, "A", 175_000), pauseAt(5000, "A", 179_000)], until: 6000 });
  const text = (now: number): string => statusText(clock({ status: t.at(now).status }), t.at(now).view);
  assert.equal(t.at(2000).state, "Ambiguous");
  assert.equal(t.at(2000).view.held, true);
  assert.equal(text(2000), "Holding at the end of the song");
  assert.equal(t.at(6000).state, "Ambiguous");
  assert.equal(t.at(6000).view.held, true);
  assert.equal(text(6000), "paused");
});
