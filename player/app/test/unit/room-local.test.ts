// The room window's two local <audio> (renderer/room-local.ts) with fake elements and fake timers:
// each follows its slot of the shell's cue, drops malformed and old cues, sets its equal-power gain
// from its position, pauses at its song's stop and reports where it is and when it failed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GAIN_MS, mountLocal, REPORT_MS } from "../../src/renderer/room-local.ts";

const URL_A = `cbp-local://play/${"a".repeat(32)}`;
const URL_B = `cbp-local://play/${"b".repeat(32)}`;
const NONE = { url: null, positionMs: 0, fade: { inToMs: 0, outFromMs: 0, stopMs: 0 } };
const slot = (url: string, positionMs: number, fade = { inToMs: 0, outFromMs: 100_000, stopMs: 106_000 }) => ({ url, positionMs, fade });
const cue = (seq: number, playing: boolean, a: unknown = NONE, b: unknown = NONE) => ({ seq, playing, slots: [a, b] });

function fakeAudio(name: string, calls: string[], playFails: () => boolean) {
  const listeners: Record<string, () => void> = {};
  const attrs: Record<string, string> = {};
  const audio = {
    currentTime: 0,
    duration: Number.NaN,
    paused: true,
    volume: 1,
    set src(v: string) {
      attrs.src = v;
      calls.push(`${name} src ${v.slice(-4)}`);
    },
    getAttribute: (k: string) => attrs[k] ?? null,
    removeAttribute: (k: string) => void delete attrs[k],
    addEventListener: (k: string, fn: () => void) => void (listeners[k] = fn),
    play: () => {
      calls.push(`${name} play`);
      audio.paused = false;
      return playFails() ? Promise.reject(new Error("no")) : Promise.resolve();
    },
    pause: () => {
      if (!audio.paused) calls.push(`${name} pause`);
      audio.paused = true;
    },
    load: () => void calls.push(`${name} load`),
    fire: (k: string) => listeners[k]?.(),
  };
  return audio;
}

function rig(fails = false) {
  const calls: string[] = [];
  const a = fakeAudio("a", calls, () => fails);
  const b = fakeAudio("b", calls, () => fails);
  const reports: unknown[][] = [];
  const timers = new Map<number, () => void>();
  let stops = 0;
  const driver = mountLocal([a, b] as unknown as [HTMLAudioElement, HTMLAudioElement], (...r) => void reports.push(r), (fn, ms) => {
    timers.set(ms, fn);
    return () => void (stops += 1);
  });
  return { a, b, calls, reports, driver, tick: (ms: number) => timers.get(ms)!(), stops: () => stops };
}

test("each element plays its slot's URL from the cued position, with the gain of its fade", () => {
  const r = rig();
  r.driver.cue(cue(1, true, slot(URL_A, 103_000), slot(URL_B, 3_000, { inToMs: 6_000, outFromMs: 100_000, stopMs: 106_000 })));
  assert.deepEqual(r.calls, ["a src aaaa", "a play", "b src bbbb", "b play"]);
  assert.equal(r.a.currentTime, 103);
  assert.equal(r.b.currentTime, 3);
  assert.ok(Math.abs(r.a.volume - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(r.b.volume - Math.SQRT1_2) < 1e-9);
  // A resent cue near where the element is neither reloads nor seeks.
  r.a.currentTime = 103.1;
  r.driver.cue(cue(2, true, slot(URL_A, 103_000), slot(URL_B, 3_000)));
  assert.equal(r.a.currentTime, 103.1);
  assert.ok(!r.calls.slice(4).some((c) => c.includes("src")));
});

test("a slot with no URL is emptied; a paused cue pauses; malformed and old cues are dropped", () => {
  const r = rig();
  r.driver.cue(cue(2, true, slot(URL_A, 0)));
  r.driver.cue(cue(1, false));
  r.driver.cue({ ...cue(3, false), slots: [slot("file:///x.mp3", 0), NONE] });
  r.driver.cue(cue(4, true, slot(URL_A, 0, { inToMs: 0, outFromMs: 2, stopMs: 1 })));
  assert.equal(r.a.paused, false);
  r.driver.cue(cue(5, false, slot(URL_A, 500)));
  assert.equal(r.a.paused, true);
  r.driver.cue(cue(6, true));
  assert.equal(r.a.getAttribute("src"), null);
  assert.ok(r.calls.includes("a load"));
});

test("the gain follows the position, and the element pauses at its song's stop", () => {
  const r = rig();
  r.driver.cue(cue(1, true, slot(URL_A, 99_000)));
  r.a.currentTime = 103;
  r.tick(GAIN_MS);
  assert.ok(Math.abs(r.a.volume - Math.SQRT1_2) < 1e-9);
  r.a.currentTime = 106;
  r.tick(GAIN_MS);
  assert.equal(r.a.volume, 0);
  assert.equal(r.a.paused, true);
  // A cue at or past the stop never starts the element.
  r.driver.cue(cue(2, true, slot(URL_A, 106_000)));
  assert.equal(r.a.paused, true);
});

test("reports name the cue and slot; an error or a refused play is reported once per cue", async () => {
  const r = rig(true);
  r.driver.cue(cue(1, true, NONE, slot(URL_B, 2_000)));
  r.b.duration = 210.0004;
  r.b.fire("loadedmetadata");
  assert.deepEqual(r.reports[0], [1, 1, 2_000, true, false, 210_000]);
  await Promise.resolve();
  r.b.fire("error");
  assert.deepEqual(r.reports.slice(1), [[1, 1, 2_000, true, true, 210_000]]);
  r.tick(REPORT_MS);
  assert.deepEqual(r.reports.length, 3, "the empty slot says nothing");
  r.driver.stop();
  assert.equal(r.stops(), 2);
});

test("one decode's loadedmetadata and durationchange are one report, so they never confirm a length alone (#946 item 3)", () => {
  const r = rig();
  r.driver.cue(cue(1, false, slot(URL_A, 0)));
  r.a.duration = 210;
  r.a.fire("durationchange");
  r.a.fire("loadedmetadata");
  r.a.fire("durationchange");
  assert.equal(r.reports.length, 1);
  // A revised length is a new report; the agreeing second report is a later read.
  r.a.duration = 211;
  r.a.fire("durationchange");
  assert.deepEqual(r.reports.map((x) => x[5]), [210_000, 211_000]);
  r.tick(REPORT_MS);
  assert.deepEqual(r.reports.map((x) => x[5]), [210_000, 211_000, 211_000]);
  // Another source starts over: its first length is reported even when equal.
  r.driver.cue(cue(2, false, slot(URL_B, 0)));
  r.a.fire("loadedmetadata");
  assert.equal(r.reports.length, 4);
});
