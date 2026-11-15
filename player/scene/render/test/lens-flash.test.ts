// The lens flash (scene.md "States", S6): at an interval change every lens flashes white once for
// `--m-flash` (160 ms), unless a burst falls on the same moment, which replaces it: one white event
// per change, never two. None in the still rig, paused, held or off the list.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_CLASS, feedAt } from "../demo/scenario.ts";
import type { FeedOptions } from "../demo/scenario.ts";
import type { Draw } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { SceneRig } from "../src/rig.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
const CHANGES_MS = DEMO_CLASS.intervals.slice(1).map((iv) => iv.startMs);

interface Run { readonly frames: { readonly ms: number; readonly flash: number; readonly burst: number }[]; readonly rig: SceneRig; readonly lensAtPeak: { colour: number; opacity: number }[] }
/** Plays 1.5 s either side of `changeMs` at 60 fps; records the flash and burst and the lenses on the first frame of the flash. */
function around(changeMs: number, options: FeedOptions = {}): Run {
  const loop = new RigLoop(tokens);
  const rig = new SceneRig(tokens);
  const frames: Run["frames"][number][] = [];
  let lensAtPeak: Run["lensAtPeak"] = [];
  for (let ms = changeMs - 1500, n = 0; ms < changeMs + 1500; n++) {
    const d: Draw = loop.step(feedAt(ms, options), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    if (d.flash > 0 && lensAtPeak.length === 0) lensAtPeak = rig.fixtures.map((f) => ({ colour: f.lensMaterial.color.getHex(), opacity: f.lensMaterial.opacity }));
    frames.push({ ms, flash: d.flash, burst: d.burst });
    ms += d.dtSeconds * 1000;
  }
  return { frames, rig, lensAtPeak };
}
const flashed = (r: Run) => r.frames.filter((f) => f.flash > 0);
const bursts = (r: Run) => r.frames.filter((f) => f.burst > 0);

test("at an interval change with no burst on it, every lens flashes white once for 160 ms", () => {
  for (const at of [20_000, 120_000, 140_000]) {
    const r = around(at);
    const f = flashed(r);
    assert.ok(f.length >= 9 && f.length <= 11, `${at}: 160 ms of 60 fps frames, got ${f.length}`);
    assert.ok(f[0]!.ms >= at && f[0]!.ms < at + 20, `${at}: starts on the change (${f[0]!.ms})`);
    assert.ok(f.at(-1)!.ms - f[0]!.ms <= 160, `${at}: over within 160 ms`);
    assert.deepEqual(bursts(r), [], `${at}: and no burst`);
    assert.equal(r.lensAtPeak.length, 22, "every lens");
    assert.ok(r.lensAtPeak.every((l) => l.colour === tokens.white && l.opacity >= 0.85), `${at}: white and bright: ${JSON.stringify(r.lensAtPeak[0])}`);
    assert.ok(f.every((x, i) => i === 0 || x.flash < f[i - 1]!.flash), "it falls away from its peak");
    assert.ok(r.rig.fixtures.every((fx) => fx.lensMaterial.color.getHex() !== tokens.white), "and is over by the end of the run");
  }
});

test("a burst on the same moment replaces the flash: the drop at 40 s, the light-only burst at 80 s, and the combined song and interval change at 60 s", () => {
  for (const at of [40_000, 60_000, 80_000]) {
    const r = around(at);
    assert.deepEqual(flashed(r), [], `${at}: no flash`);
    assert.ok(bursts(r).length >= 12, `${at}: the burst is there instead`);
  }
});

test("every interval change gives one white event, a flash or a burst, never both and never neither", () => {
  for (const at of CHANGES_MS) {
    const r = around(at);
    assert.ok(flashed(r).length > 0 !== bursts(r).length > 0, `${at}: flash ${flashed(r).length} frames, burst ${bursts(r).length} frames`);
  }
  // A song change that is also an interval change into a song with moments (100 s) flashes: its burst is the drop's alone.
  assert.ok(flashed(around(100_000)).length > 0);
});

test("no flash in the still rig, paused, held or off the list; none without a change", () => {
  for (const options of [{ reducedMotion: true }, { link: { state: "Paused" } }, { link: { state: "Locked", held: true } }, { link: { state: "Off the list" } }] as FeedOptions[]) {
    for (const at of [20_000, 120_000]) assert.deepEqual(flashed(around(at, options)), [], JSON.stringify(options));
  }
  const loop = new RigLoop(tokens);
  for (let ms = 24_000, n = 0; ms < 36_000; n++) { assert.equal(loop.step(feedAt(ms), n === 0 ? 0 : 1 / 60, "High").flash, 0); ms += 1000 / 60; }
});

test("a drop due within the flash's span replaces the flash too", () => {
  const cls = { ...DEMO_CLASS, songs: DEMO_CLASS.songs.map((s, i) => (i === 0 ? { ...s, moments: [{ at_ms: 20_100, kind: "drop" as const }] } : s)) };
  const loop = new RigLoop(tokens);
  let [flash, burst] = [0, 0];
  for (let ms = 18_500, n = 0; ms < 21_500; n++) {
    const d = loop.step({ ...feedAt(ms), cls }, n === 0 ? 0 : 1 / 60, "High");
    flash += d.flash > 0 ? 1 : 0;
    burst += d.burst > 0 ? 1 : 0;
    ms += d.dtSeconds * 1000;
  }
  assert.deepEqual([flash, burst > 0], [0, true]);
});
