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
import { shapePaths } from "./shape-paths.ts";
import { feedOf } from "../join/room-feed-calc.ts";
import type { JoinFrame } from "../join/room-feed-calc.ts";
import { RUNNING_DOC } from "../demo/running-class.ts";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// The shapes are read with the compiler, so `extends`, quoted keys, intersections, methods and named nested types
// (BeatAnchor, SongMoment) all count, and an index signature fails by existing. Each list is the whole path set.
test("the join's frame has exactly these fields (the class file itself is pinned by its schema type)", () => {
  assert.deepEqual(shapePaths("../join/room-feed-calc.ts", "JoinFrame", ["doc"]), [
    "doc", "link", "link.announcement", "link.available", "link.held", "link.mode", "link.songIndex", "link.state",
    "mix", "mix.shape", "mix.text", "playlistNotLoaded", "view", "view.classMs", "view.songIndex", "view.status",
  ]);
});

test("the scene's feed has exactly these fields, nested records included, and the link the join hands it too", () => {
  assert.deepEqual(shapePaths("../src/loop.ts", "Feed"), [
    "classMs", "cls", "cls.endMs", "cls.intervals", "cls.intervals[].pattern", "cls.intervals[].startMs", "cls.intervals[].zone",
    "cls.songs", "cls.songs[].anchors", "cls.songs[].anchors[].at_ms", "cls.songs[].anchors[].bpm", "cls.songs[].bpm", "cls.songs[].lengthMs",
    "cls.songs[].moments", "cls.songs[].moments[].at_ms", "cls.songs[].moments[].kind",
    "link", "link.held", "link.state", "playlistNotLoaded", "reducedMotion", "songIndex", "songPosMs", "stage",
  ]);
  assert.deepEqual(shapePaths("../src/text-types.ts", "TextLink"), ["announcement", "available", "held", "mix", "mix.shape", "mix.text", "mode", "started", "state"]);
});

test("the scene's class is closed: an interval is a start, a zone and its pattern, a song its timing", () => {
  assert.deepEqual(shapePaths("../../model/src/frame.ts", "SceneClass"), [
    "endMs", "intervals", "intervals[].pattern", "intervals[].startMs", "intervals[].zone",
    "songs", "songs[].anchors", "songs[].anchors[].at_ms", "songs[].anchors[].bpm", "songs[].bpm", "songs[].lengthMs", "songs[].moments", "songs[].moments[].at_ms", "songs[].moments[].kind",
  ]);
});

/** What `feedOf` reads of a frame, by path (array indexes as `[]`, built-in members left out): everything under a Proxy, the class file included. */
function readsOf(frame: JoinFrame): Set<string> {
  const reads = new Set<string>();
  const builtin = new Set([...Object.getOwnPropertyNames(Array.prototype), ...Object.getOwnPropertyNames(Object.prototype)]);
  const wrap = <T extends object>(value: T, path: string): T => new Proxy(value, {
    get(target, key, receiver) {
      const got: unknown = Reflect.get(target, key, receiver);
      if (typeof key === "symbol" || (Array.isArray(target) && key === "length") || (builtin.has(key) && !(key in (target as object) && Object.hasOwn(target, key)))) return got;
      const at = /^\d+$/.test(key) ? `${path}[]` : path === "" ? key : `${path}.${key}`;
      if (!/^\d+$/.test(key)) reads.add(at);
      return typeof got === "object" && got !== null ? wrap(got, at) : got;
    },
    ownKeys(target) { reads.add(`${path}{enumerated}`); return Reflect.ownKeys(target); },
  });
  feedOf(wrap(frame, ""), 100, false);
  return reads;
}

test("feedOf reads only these paths of the frame and the class file: no incline, no reading", () => {
  const ALLOWED = [
    "doc", "doc.class", "doc.class.length_ms", "doc.class.title", "doc.intervals", "doc.intervals[]", "doc.intervals[].cadence", "doc.intervals[].cadence.from", "doc.intervals[].cadence.to", "doc.intervals[].cue", "doc.intervals[].length_ms",
    "doc.intervals[].pattern", "doc.intervals[].start_ms", "doc.intervals[].zone", "doc.intervals[].position", "doc.music", "doc.music.source", "doc.segments",
    "doc.songs", "doc.songs[]", "doc.songs[].artist", "doc.songs[].beat_anchors", "doc.songs[].beat_anchors.anchors", "doc.songs[].beat_anchors.quality", "doc.songs[].bpm",
    "doc.songs[].length_ms", "doc.songs[].moments", "doc.songs[].moments.items", "doc.songs[].moments.quality", "doc.songs[].start_ms", "doc.songs[].title",
    "doc.zone_scale", "doc.zone_scale[]", "doc.zone_scale[].hrmax_pct", "doc.zone_scale[].ftp_pct", "doc.zone_scale[].name", "doc.zone_scale[].rpe", "doc.zone_scale[].zone",
    "link", "link.announcement", "link.available", "link.held", "link.mode", "link.songIndex", "link.state", "mix", "mix.shape", "mix.text",
    "playlistNotLoaded", "view", "view.classMs", "view.songIndex", "view.status",
  ];
  const loose = (path: string): boolean => /\{enumerated\}$/.test(path);
  const seen = new Set<string>();
  for (const [view, , state] of MOMENTS) for (const doc of [RUNNING_DOC, cycling]) readsOf(frame(doc, view, state)).forEach((r) => seen.add(r));
  assert.deepEqual([...seen].filter((r) => !ALLOWED.includes(r) && !loose(r)), [], "feedOf reads something outside the allowlist");
  assert.deepEqual([...seen].filter(loose), [], "feedOf enumerates an object, so it could forward what it holds");
  assert.ok(seen.has("doc.intervals[].zone") && seen.has("view.classMs"), "the probe sees the reads");
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
  const NAMES = /\b(incline|treadmill|foot[ _-]?pod|speed\w*|\w*velocity\w*|\w*kmh\w*|grade|pace|distance|sensors?|readings?|rsc|ftms|bluetooth|rpm|steps?_?per|heart[ _-]?rate|heartRate|hr|bpm|power|watts?)\b/i;
  for (const f of ["../join/room-feed-calc.ts", "../join/scene-join.ts", "../join/mount.ts", "../../model/src/frame.ts", "../src/loop.ts"]) {
    const found = [...code(f).matchAll(new RegExp(NAMES, "gi"))].map((m) => m[0]);
    // Allowed by word: "speed" in loop.ts and frame.ts is the beams' angular speed (scene.md "How a beam turns"); "bpm" in room-feed-calc.ts, frame.ts and loop.ts is the song's tempo from the class file. Never a rider's.
    const allowed = found.filter((w) => !((f.endsWith("loop.ts") || f.endsWith("frame.ts")) && /^speed\w*$/i.test(w)) && !((f.endsWith("room-feed-calc.ts") || f.endsWith("frame.ts") || f.endsWith("loop.ts")) && /^bpm$/i.test(w)));
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
