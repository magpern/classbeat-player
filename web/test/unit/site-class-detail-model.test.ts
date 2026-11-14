// The class details page's model (src/site/core/class-detail-model.ts): plain text from the
// answer of `GET classes/{id}`, read as it came; a part of another shape is left out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detailOf, targetsOf } from "../../src/site/core/class-detail-model.ts";
import { classReply, document, runningDocument } from "../lib/class-states.ts";

const NOW = new Date(2026, 10, 14, 12, 0, 0);
const body = (doc: unknown = document()): unknown => classReply(doc).body;

describe("a class's details", () => {
  it("reads the title, the facts, the time in zone, the songs and the intervals", () => {
    const d = detailOf(body(), NOW);
    assert.ok(d);
    assert.equal(d.title, "Monday morning endurance");
    assert.match(d.facts, /^45:00 · Cycling · Spotify, 6 songs · From classbeat · changed 9 Nov$/);
    assert.deepEqual(d.zones.map((z) => [z.zone, z.name, z.time]), [[1, "Recovery", "5:00"], [2, "Endurance", "28:00"], [3, "Tempo", "5:00"], [4, "Threshold", "6:00"], [5, "Hard", "1:00"]]);
    assert.deepEqual(d.songs[0], { no: 1, title: "Midnight City", artist: "M83", length: "4:03" });
    assert.equal(d.songs.length, 6);
    assert.deepEqual(d.intervals[0], { when: "0:00 for 5:00", zone: "Zone 1 Recovery", targets: "Cadence 80 to 90, seated", cue: "Easy spin, loosen the legs" });
    assert.equal(d.intervals[4].targets, "Cadence on the beat, seated");
    assert.equal(d.intervals[3].targets, "Cadence 70 to 80, standing");
  });

  it("lists the zones in zone order, whatever order the totals came in", () => {
    const doc = { ...document(), totals: { length_ms: 1, time_in_zone_ms: { 5: 60_000, 1: 60_000, 3: 60_000 } } };
    assert.deepEqual(detailOf(body(doc), NOW)?.zones.map((z) => z.zone), [1, 3, 5]);
  });

  it("shows a running class by its incline, and a class with no music as such", () => {
    const d = detailOf(body(runningDocument()), NOW);
    assert.ok(d);
    assert.match(d.facts, /^20:00 · Running · No music · /);
    assert.deepEqual(d.intervals.map((i) => i.targets), ["Incline flat", "Incline raised"]);
    assert.deepEqual(d.songs, []);
  });

  it("has no ranking and no figure the spec leaves out: no planned load, no play count, no rider", () => {
    const doc = { ...document(), totals: { ...document().totals, planned_load: 62.5 } };
    const d = JSON.stringify(detailOf(body(doc), NOW));
    for (const word of ["62.5", "load", "played", "rank", "rider"]) assert.ok(!d.includes(word), word);
  });

  it("gives the heading and the facts it has when the answer holds no document", () => {
    const d = detailOf({ class_id: "x", source: "classbeat", changed_at: new Date(2026, 10, 14, 8).toISOString() }, NOW);
    assert.deepEqual(d, { title: null, facts: "From classbeat · changed today", zones: [], songs: [], intervals: [] });
  });

  it("leaves out a part that is not the format's shape, and keeps the rest", () => {
    const doc = { class: { title: "T", length_ms: "x" }, music: 3, zone_scale: [null, { zone: "a" }], totals: { time_in_zone_ms: { 9: 1, 2: "x", 3: 60_000 } }, intervals: [null, { start_ms: 0, length_ms: 1000, zone: 2, cue: "go" }, { start_ms: "a" }], songs: [{ title: 4 }, { title: "S" }] };
    const d = detailOf({ document: doc }, NOW);
    assert.ok(d);
    assert.equal(d.title, "T");
    assert.deepEqual(d.zones, [{ zone: 3, name: "", time: "1:00" }]);
    assert.deepEqual(d.songs, [{ no: 1, title: "S", artist: "", length: "" }]);
    assert.deepEqual(d.intervals, [{ when: "0:00 for 0:01", zone: "Zone 2", targets: "", cue: "go" }]);
  });

  it("is null when the answer is not an object", () => {
    for (const bad of [null, "x", 3, []]) assert.equal(detailOf(bad, NOW), null);
  });
});

describe("an interval's targets", () => {
  const table: readonly (readonly [string, Record<string, unknown>, string])[] = [
    ["cadence and position", { cadence: { from: 80, to: 90 }, position: "seated" }, "Cadence 80 to 90, seated"],
    ["on the beat", { cadence: "beat", position: "standing" }, "Cadence on the beat, standing"],
    ["an incline", { incline: "raised" }, "Incline raised"],
    ["a test", { cadence: { from: 90, to: 100 }, position: "seated", test: { kind: "ftp", minutes: 20 } }, "Cadence 90 to 100, seated, FTP test, 20 minutes"],
    ["nothing it knows", { cadence: "fast", position: "lying" }, ""],
  ];
  for (const [name, iv, want] of table) it(name, () => assert.equal(targetsOf(iv), want));
});
