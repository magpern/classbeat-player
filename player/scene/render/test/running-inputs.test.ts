// PL10, issue #772, ADR 0015 section 2, rules 4 and 5: in a running class the scene keeps its light-only look and
// takes no reading. The scene's input surface is pinned as an allowlist, in three ways, so that adding a speed,
// an incline, a cadence or any sensor reading anywhere along the way fails here:
//  1. the declared shape: the fields of the join's frame, the scene's feed and the scene class are exactly the
//     lists below (read from the source, so a field added to an interface fails);
//  2. the values: a running class and a cycling class with the same zones and songs give the very same feed, and
//     readings smuggled into the class or the frame change nothing and reach no key of the feed;
//  3. the code: nothing along the path names an incline, a treadmill, a foot pod, a speed or a sensor, or imports
//     one. The player's sensor panel keeps its "unavailable" source (ADR 0012 section 6).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { UNAVAILABLE_SOURCE } from "../../../app/src/core/sensors/unavailable-source.ts";
import { feedOf } from "../join/room-feed-calc.ts";
import type { JoinFrame } from "../join/room-feed-calc.ts";
import { RUNNING_DOC } from "../demo/running-class.ts";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The property names an interface declares, nested object types included, and whether it has an index signature. */
function declared(rel: string, name: string): { keys: string[]; open: boolean } {
  const body = code(rel).match(new RegExp(`export interface ${name}(?:\\s+extends\\s+[^{]+)?\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  assert.ok(body !== undefined, `${name} is declared in ${rel}`);
  const keys = [...body.matchAll(/(?:^|[\s{;,])(?:readonly\s+)?([A-Za-z_]\w*)\??\s*:/gm)].map((m) => m[1]!);
  return { keys: [...new Set(keys)].sort(), open: /\[\s*\w+\s*:\s*string\s*\]/.test(body) };
}

test("the join's frame has exactly these fields, and so has the scene's feed", () => {
  assert.deepEqual(declared("../join/room-feed-calc.ts", "JoinFrame").keys, ["announcement", "available", "classMs", "doc", "held", "link", "mix", "mode", "playlistNotLoaded", "shape", "songIndex", "state", "status", "text", "view"]);
  assert.deepEqual(declared("../src/loop.ts", "Feed").keys, ["classMs", "cls", "link", "playlistNotLoaded", "reducedMotion", "songIndex", "songPosMs", "stage"]);
});

test("the music link the feed carries has exactly these fields", () => {
  assert.deepEqual(declared("../../model/src/beat-level.ts", "LinkInput").keys, ["held", "state"]);
  assert.deepEqual(declared("../src/text-types.ts", "TextLink").keys, ["announcement", "available", "mix", "mode", "shape", "started", "text"]);
});

test("the scene's class has exactly these fields: an interval is a start and a zone, a song its timing", () => {
  assert.deepEqual(declared("../../model/src/frame.ts", "SceneClass").keys, ["endMs", "intervals", "songs"]);
  assert.deepEqual(declared("../../model/src/frame.ts", "SceneSong").keys, ["anchors", "bpm", "lengthMs", "moments"]);
  const iv = declared("../../model/src/frame.ts", "SceneInterval");
  assert.deepEqual(iv.keys, ["startMs", "zone"]);
  // The index signature is the demo's old way of carrying a pattern; it is open on purpose today, so the run-time check below, on what the join builds, is what holds.
  assert.equal(iv.open, true, "SceneInterval's index signature is still the one this test knows");
});

/** The same class as a cycling class: same zones, songs and times; each interval has a cadence and a position where the running one has an incline. */
function asCycling(doc: Class): Class {
  const copy = structuredClone(doc) as unknown as { class: { sport: string }; intervals: Record<string, unknown>[] };
  copy.class.sport = "cycling";
  for (const iv of copy.intervals) { delete iv.incline; iv.cadence = { from: 80, to: 90 }; iv.position = "seated"; }
  return copy as unknown as Class;
}
const cycling = asCycling(RUNNING_DOC);

const frame = (doc: Class, over: Partial<NonNullable<JoinFrame["view"]>> = {}, state: NonNullable<JoinFrame["link"]>["state"] = "Locked"): JoinFrame => ({
  doc, playlistNotLoaded: false, mix: null, view: { status: "running", classMs: 27_000, songIndex: null, ...over },
  link: { mode: "following", state, held: false, songIndex: null, announcement: null, available: true },
});
const MOMENTS: readonly [Partial<NonNullable<JoinFrame["view"]>>, number, NonNullable<JoinFrame["link"]>["state"]][] = [
  [{ classMs: 0, status: "ready" }, 0, "Locked"], [{ classMs: 5_000 }, 0, "Locked"], [{ classMs: 27_000 }, 120, "Locked"], [{ classMs: 41_000 }, 0, "Locked"], [{ classMs: 59_000 }, 250, "Coasting"],
  [{ classMs: 75_000 }, 0, "Paused"], [{ classMs: 105_000 }, 0, "Locked"], [{ classMs: 130_000 }, 300, "Off the list"], [{ classMs: 159_000, status: "ended" }, 0, "Locked"],
] as never;

test("a running class and a cycling class with the same zones and songs give the scene the very same feed", () => {
  for (const [view, since, state] of MOMENTS) for (const reduced of [false, true]) {
    const a = feedOf(frame(RUNNING_DOC, view, state), since, reduced);
    const b = feedOf(frame(cycling, view, state), since, reduced);
    assert.ok(a !== null && b !== null);
    assert.deepEqual(a.feed, b.feed, JSON.stringify(view));
  }
});

/** Every key anywhere in the feed: an allowlist, the keys of the two interfaces above and of the beat and moment records the songs carry. */
const FEED_KEYS = new Set(["cls", "classMs", "songIndex", "songPosMs", "link", "reducedMotion", "playlistNotLoaded", "stage", "intervals", "songs", "endMs", "startMs", "zone", "bpm", "lengthMs", "anchors", "moments", "at_ms", "kind", "state", "held", "mode", "started", "announcement", "available", "mix", "text", "shape"]);
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
  else if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) { into.add(k); keysOf(v, into); }
  return into;
}

test("readings put on the class, the interval or the frame change nothing and reach no key of the feed", () => {
  const READINGS = { speed_kmh: 14.2, incline_pct: 3, cadence_spm: 168, pace: "4:20", distance_m: 1200, heart_rate: 150, reading: { speed: 9 }, treadmill: { speed: 9 } };
  const loaded = structuredClone(RUNNING_DOC) as unknown as { intervals: Record<string, unknown>[]; songs: Record<string, unknown>[]; class: Record<string, unknown> };
  Object.assign(loaded.class, READINGS);
  for (const iv of loaded.intervals) Object.assign(iv, READINGS);
  for (const s of loaded.songs) Object.assign(s, READINGS);
  for (const [view, since, state] of MOMENTS) {
    const plain = feedOf(frame(RUNNING_DOC, view, state), since, false);
    const dirty = { ...frame(loaded as unknown as Class, view, state), ...READINGS, view: { status: "running", classMs: 27_000, songIndex: null, ...view, ...READINGS } } as JoinFrame;
    const got = feedOf(dirty, since, false);
    assert.ok(plain !== null && got !== null);
    assert.deepEqual(got.feed, plain.feed, "a reading changed the feed");
    assert.deepEqual([...keysOf(got.feed)].filter((k) => !FEED_KEYS.has(k)), [], "a key outside the allowlist is in the feed");
    for (const iv of got.feed.cls.intervals) assert.deepEqual(Object.keys(iv).sort(), ["startMs", "zone"], "an interval carries more than its start and zone");
  }
});

test("the scene's own code names no reading: no incline, treadmill, foot pod, speed, pace, distance or sensor along the join and the feed", () => {
  const NAMES = /\b(incline|treadmill|foot[ _-]?pod|speed\w*|pace|distance|sensors?|readings?|rsc|ftms|bluetooth|rpm|steps?_?per)\b/i;
  for (const f of ["../join/room-feed-calc.ts", "../join/scene-join.ts", "../join/mount.ts", "../../model/src/frame.ts", "../src/loop.ts"]) {
    const found = [...code(f).matchAll(new RegExp(NAMES, "gi"))].map((m) => m[0]);
    // The turn limiter's and the loop's "speed" is the beams' angular speed (scene.md "How a beam turns"), never a rider's: allowed in loop.ts and frame.ts only by that word.
    const allowed = f.endsWith("loop.ts") || f.endsWith("frame.ts") ? found.filter((w) => !/^speed\w*$/i.test(w)) : found;
    assert.deepEqual(allowed, [], `${f} names a reading`);
  }
  for (const f of ["../join/room-feed-calc.ts", "../join/scene-join.ts", "../join/mount.ts"]) {
    const specs = [...code(f).matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    assert.deepEqual(specs.filter((s) => /sensor|treadmill|bluetooth/i.test(s)), [], `${f} imports a sensor module`);
  }
});

test("the player's sensor panel stays on the unavailable source, whatever class is open", () => {
  const snap = UNAVAILABLE_SOURCE.snapshot();
  assert.equal(snap.state, "unavailable");
  assert.deepEqual([snap.devices, snap.nearby, snap.failed], [[], [], null]);
  assert.equal(UNAVAILABLE_SOURCE.snapshot.length, 0, "the source is asked for nothing, so no class can change what it says");
  const presenter = code("../../../app/src/renderer/presenter.ts");
  assert.match(presenter, /mountSensors\(UNAVAILABLE_SOURCE\)/);
  assert.equal([...presenter.matchAll(/mountSensors\(/g)].length, 1);
});
