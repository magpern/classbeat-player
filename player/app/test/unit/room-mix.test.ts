// The room window's <audio> driver (renderer/room-mix.ts) with a fake element and a fake timer: it
// follows the shell's cues, drops malformed and old ones, and reports where it is and when it failed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mountMix, REPORT_MS } from "../../src/renderer/room-mix.ts";

const URL1 = `cbp-mix://play/${"1".repeat(32)}`;
const URL2 = `cbp-mix://play/${"2".repeat(32)}`;

function rig(playFails = false) {
  const listeners: Record<string, () => void> = {};
  const attrs: Record<string, string> = {};
  const calls: string[] = [];
  const audio = {
    currentTime: 0,
    duration: Number.NaN,
    paused: true,
    get src() {
      return attrs.src ?? "";
    },
    set src(v: string) {
      attrs.src = v;
      calls.push(`src ${v}`);
    },
    getAttribute: (k: string) => attrs[k] ?? null,
    removeAttribute: (k: string) => void delete attrs[k],
    addEventListener: (k: string, fn: () => void) => void (listeners[k] = fn),
    play: () => {
      calls.push("play");
      audio.paused = false;
      return playFails ? Promise.reject(new Error("no")) : Promise.resolve();
    },
    pause: () => {
      calls.push("pause");
      audio.paused = true;
    },
    load: () => void calls.push("load"),
  };
  const reports: [number, number, boolean, boolean, number | null][] = [];
  let tick: () => void = () => undefined;
  let stopped = false;
  let period = 0;
  const driver = mountMix(
    audio as unknown as HTMLAudioElement,
    (...r) => void reports.push(r),
    (fn, ms) => {
      tick = fn;
      period = ms;
      return () => (stopped = true);
    },
  );
  return {
    audio,
    calls,
    reports,
    driver,
    tick: () => tick(),
    fire: (k: string) => listeners[k]?.(),
    stopped: () => stopped,
    period: () => period,
  };
}

test("a cue sets the source, the position and plays; the reports say where it is", () => {
  const r = rig();
  assert.equal(r.period(), REPORT_MS);
  r.tick();
  assert.deepEqual(r.reports, [], "no report before a cue");
  r.driver.cue({ seq: 1, url: URL1, playing: true, positionMs: 5_000 });
  assert.deepEqual(r.calls, [`src ${URL1}`, "play"]);
  assert.equal(r.audio.currentTime, 5);
  r.audio.currentTime = 6.2;
  r.tick();
  assert.deepEqual(r.reports, [[1, 6200, true, false, null]]);
});

test("a later cue for the same play seeks and pauses without reloading the source", () => {
  const r = rig();
  r.driver.cue({ seq: 1, url: URL1, playing: true, positionMs: 0 });
  r.driver.cue({ seq: 2, url: URL1, playing: false, positionMs: 9_000 });
  assert.deepEqual(r.calls, [`src ${URL1}`, "play", "pause"]);
  assert.equal(r.audio.currentTime, 9);
  r.driver.cue({ seq: 3, url: URL2, playing: true, positionMs: 0 });
  assert.equal(r.calls.at(-2), `src ${URL2}`);
});

test("malformed, foreign and old cues are ignored", () => {
  const r = rig();
  r.driver.cue({ seq: 2, url: URL1, playing: true, positionMs: 0 });
  const n = r.calls.length;
  for (const bad of [
    null,
    "x",
    {
      seq: 3,
      url: "https://example.invalid/a.mp3",
      playing: true,
      positionMs: 0,
    },
    { seq: 3, url: "file:///etc/passwd", playing: true, positionMs: 0 },
    { seq: 3, url: URL1, playing: true, positionMs: -1 },
    { seq: 3, url: URL1, playing: true, positionMs: 0, extra: 1 },
    { seq: 2, url: URL2, playing: true, positionMs: 0 },
    { seq: 1, url: URL2, playing: true, positionMs: 0 },
  ])
    r.driver.cue(bad);
  assert.equal(r.calls.length, n);
  assert.equal(r.audio.getAttribute("src"), URL1);
});

test("an empty cue empties the audio and stops the reports", () => {
  const r = rig();
  r.driver.cue({ seq: 1, url: URL1, playing: true, positionMs: 0 });
  r.driver.cue({ seq: 2, url: null, playing: false, positionMs: 0 });
  assert.deepEqual(r.calls.slice(-2), ["pause", "load"]);
  assert.equal(r.audio.getAttribute("src"), null);
  r.tick();
  r.fire("error");
  assert.deepEqual(r.reports, []);
});

test("an error is reported once per cue as failed", () => {
  const r = rig();
  r.driver.cue({ seq: 1, url: URL1, playing: true, positionMs: 0 });
  r.fire("error");
  r.fire("error");
  assert.deepEqual(r.reports, [[1, 0, true, true, null]]);
  r.driver.cue({ seq: 2, url: URL1, playing: true, positionMs: 0 });
  r.fire("error");
  assert.equal(r.reports.filter((x) => x[3]).length, 2);
});

test("a refused play() is reported as failed", async () => {
  const r = rig(true);
  r.driver.cue({ seq: 1, url: URL1, playing: true, positionMs: 0 });
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(r.reports.at(-1)?.[3], true);
});

test("stop ends the reports", () => {
  const r = rig();
  r.driver.stop();
  assert.equal(r.stopped(), true);
});

test("the decoded length is reported in ms once known, at once on loadedmetadata", () => {
  const r = rig();
  r.fire("loadedmetadata");
  assert.deepEqual(r.reports, [], "no report before a cue");
  r.driver.cue({ seq: 1, url: URL1, playing: true, positionMs: 0 });
  r.audio.duration = 2_700.0004;
  r.fire("loadedmetadata");
  assert.deepEqual(r.reports, [[1, 0, true, false, 2_700_000]]);
  r.audio.duration = 2_701;
  r.fire("durationchange");
  assert.deepEqual(r.reports.at(-1), [1, 0, true, false, 2_701_000], "a revised length is reported at once");
  for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, -1]) {
    r.audio.duration = bad;
    r.tick();
    assert.equal(r.reports.at(-1)?.[4], null, String(bad));
  }
});

test("one decode's loadedmetadata and durationchange are one report, so they never confirm a length alone (#946 item 3)", () => {
  const r = rig();
  r.driver.cue({ seq: 1, url: URL1, playing: true, positionMs: 0 });
  r.audio.duration = 2_700;
  r.fire("durationchange");
  r.fire("loadedmetadata");
  r.fire("durationchange");
  assert.equal(r.reports.length, 1);
  // The agreeing second report is a later read of the settled length.
  r.tick();
  assert.deepEqual(r.reports.map((x) => x[4]), [2_700_000, 2_700_000]);
  // A new source starts over: its first length is reported even when equal to the last one's.
  r.driver.cue({ seq: 2, url: URL1.replace(/.$/, "f"), playing: true, positionMs: 0 });
  r.fire("loadedmetadata");
  assert.equal(r.reports.length, 3);
});
