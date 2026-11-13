import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toRoomModel } from "../../src/room/adapter.ts";
import { FIXTURES, STATE_NAMES, WORST_NAMES } from "../../src/fixtures/index.ts";
import { STATE_FIXTURES } from "../../src/fixtures/states.ts";
import { clockAt, linkAt } from "../../src/fixtures/build.ts";
import type { RoomInput } from "../../src/room/input.ts";

const model = (name: string) => toRoomModel(FIXTURES[name]);

describe("adapter: the states of room-2d.md", () => {
  it("running, locked: the full layout, 'Following Spotify' quiet, bars to the change", () => {
    const m = model("running");
    assert.equal(m.kind, "running");
    assert.deepEqual([m.gel?.look, m.gel?.zone, m.gel?.name, m.gel?.targets], ["zone", 4, "Threshold", ["88–94% FTP", "RPE 5–6"]]);
    assert.deepEqual(m.rail, { left: "23:41", done: "18:19", segment: "Main set", link: { text: "Following Spotify", look: "quiet" } });
    assert.deepEqual([m.clock?.label, m.clock?.count, m.clock?.wide, m.clock?.estimated, m.clock?.pill], ["Interval left", "1:10", false, false, false]);
    assert.deepEqual(m.clock?.line, { kind: "bars", count: 37, tail: "bars to the change" });
    assert.deepEqual(m.metrics.map((x) => [x.label, x.value, x.unit]), [["Cadence", "90–100", "rpm"], ["Position", "Seated", null], ["Song", "128", "bpm"]]);
    assert.deepEqual(m.next, { end: false, zone: 2, name: "Endurance", length: "0:45", cadence: "85–95 rpm", position: "Seated" });
    assert.equal(m.cue?.text, "Find the beat and hold it. Breathe out on every second bar.");
    assert.equal(m.cue?.long, false);
    assert.ok(m.beat, "locked, with beat anchors: the dot");
    assert.equal(m.moving, true);
  });

  it("before the start: lights down on the first zone, the class laid out, no cue", () => {
    const m = model("before-start");
    assert.equal(m.kind, "before-start");
    assert.deepEqual([m.gel?.look, m.gel?.label, m.gel?.zone], ["down", "First zone", 1]);
    assert.equal(m.rail.link?.text, "Waiting for the first song");
    assert.equal(m.cue, null);
    assert.equal(m.intro?.title, "Thursday threshold");
    assert.deepEqual(m.intro?.facts.map((f) => f.label), ["Length", "Songs", "Intervals", "Class load"]);
    assert.equal(m.intro?.zones.length, 7);
    assert.equal(m.moving, false);
  });

  it("before the start with the manual clock says 'Press Start'", () => {
    const base = STATE_FIXTURES["before-start"];
    const view = base.view;
    assert.ok(view);
    const m = toRoomModel({ ...base, link: linkAt(view, "Manual") });
    assert.equal(m.rail.link?.text, "Press Start");
  });

  it("paused: lights down, a 'Paused' plate, 'Starts again with the music', the clock does not move", () => {
    const m = model("paused");
    assert.equal(m.gel?.look, "down");
    assert.equal(m.clock?.pill, true);
    assert.deepEqual(m.clock?.line, { kind: "text", text: "Starts again with the music" });
    assert.deepEqual(m.rail.link, { text: "Music paused", look: "alert" });
    assert.equal(m.moving, false);
    assert.equal(m.beat, null, "no beat dot while paused");
  });

  it("coasting: 'Music not heard', estimated, no bar count, no beat dot", () => {
    const m = model("coasting");
    assert.deepEqual(m.rail.link, { text: "Music not heard", look: "alert" });
    assert.deepEqual([m.clock?.label, m.clock?.estimated, m.clock?.line], ["Interval left, estimated", true, null]);
    assert.equal(m.cue?.long, true);
    assert.equal(m.score?.unsure, true);
    assert.equal(m.beat, null);
  });

  it("off the list: 'Not a class song', the song's BPM is called planned", () => {
    const m = model("off-list");
    assert.equal(m.rail.link?.text, "Not a class song");
    assert.equal(m.metrics[2].label, "Song, planned");
    assert.equal(m.clock?.line, null);
  });

  it("ambiguous: 'Song is in twice' and the clip says which occurrence", () => {
    const m = model("ambiguous");
    assert.equal(m.rail.link?.text, "Song is in twice");
    assert.ok(m.score?.clips.some((c) => c.title === "Neon Avenue" && c.occurrence === "1st of 2" && c.artist === null));
  });

  it("manual clock: a grey marker, not a plate; no bar count", () => {
    const m = model("manual");
    assert.deepEqual(m.rail.link, { text: "Manual clock", look: "manual" });
    assert.equal(m.clock?.line, null);
    assert.equal(m.beat, null);
  });

  it("last interval: its label, bars to the end, 'End of class' next, an End mark", () => {
    const m = model("last-interval");
    assert.equal(m.clock?.label, "Last interval");
    assert.deepEqual(m.clock?.line, { kind: "bars", count: 60, tail: "bars to the end" });
    assert.deepEqual(m.next, { end: true, zone: 0, name: "", length: "", cadence: null, position: null });
    assert.equal(m.metrics[0].value, "On the beat");
    assert.equal(m.rail.segment, "Cool-down");
    assert.notEqual(m.score?.endLeft, null);
  });

  it("finished: the house lights up, a white gel with no zone, 'Class Complete' and the length", () => {
    const m = model("finished");
    assert.equal(m.kind, "finished");
    assert.deepEqual([m.gel?.look, m.gel?.zone, m.gel?.label, m.gel?.name, m.gel?.targets], ["blank", null, "Class", "Complete", ["42:00"]]);
    assert.deepEqual(m.intro?.facts.map((f) => f.label), ["Ridden", "Songs", "Class load, planned"]);
    assert.equal(m.clock, null);
  });

  it("FTP test: the tag, a 20-minute interval sized for MM:SS, the time to the next song", () => {
    const m = model("ftp-test");
    assert.deepEqual([m.clock?.ftpTag, m.clock?.count, m.clock?.wide], [true, "18:42", true]);
    assert.deepEqual(m.clock?.line, { kind: "song", time: "1:22" });
    assert.equal(m.gel?.nameTier, "two");
    assert.equal(m.cue?.long, true);
  });

  it("every state of the spec has a fixture", () => {
    assert.deepEqual([...STATE_NAMES].sort(), ["ambiguous", "before-start", "coasting", "finished", "ftp-test", "last-interval", "manual", "off-list", "paused", "running"]);
    assert.equal(WORST_NAMES.length, 6);
  });
});

describe("adapter: timing details", () => {
  const base = STATE_FIXTURES.running;
  const at = (remainingMs: number, patch: Partial<NonNullable<RoomInput["link"]>> = {}): ReturnType<typeof toRoomModel> => {
    const doc = base.doc;
    assert.ok(doc && base.view);
    const classMs = 1_169_000 - remainingMs;
    const view = clockAt(doc, classMs);
    return toRoomModel({ doc, view, link: linkAt(view, "Locked", patch) });
  };

  it("the last five seconds of an interval read 'Change in'", () => {
    assert.equal(at(5000).clock?.label, "Change in");
    assert.equal(at(6000).clock?.label, "Interval left");
  });

  it("holding at a song change: 'Until the next song' and the expected time to it", () => {
    const m = at(0, { held: true, holdRemainingMs: 12_000 });
    assert.deepEqual([m.clock?.label, m.clock?.count, m.moving], ["Until the next song", "0:12", false]);
  });

  it("the interval changes the key the gel's flash follows", () => {
    assert.notEqual(at(30_000).intervalKey, at(-1000).intervalKey);
    assert.equal(at(30_000).intervalKey, at(31_000).intervalKey);
  });

  it("time left in the class follows the link's measurement while following", () => {
    const m = at(30_000, { classRemainingMs: 1_000_000 });
    assert.equal(m.rail.left, "16:40");
  });

  it("without a class or a clock the screen is empty, not broken", () => {
    assert.equal(toRoomModel({ doc: null, view: null, link: null }).kind, "empty");
  });
});

describe("adapter: the product rules hold in every fixture", () => {
  const all = [...STATE_NAMES, ...WORST_NAMES].map((n) => [n, JSON.stringify(model(n))] as const);

  it("rule 9: own names for load figures", () => {
    for (const [n, json] of all) assert.doesNotMatch(json, /TSS|Training Stress|Normalized Power|Intensity Factor/i, n);
  });

  it("rules 8, 11, 13: no heart-rate instruction, no suggestion, no rider data", () => {
    for (const [n, json] of all) assert.doesNotMatch(json, /adjust|heart rate|your best|personal best|rank|leaderboard/i, n);
  });

  it("rule 7: only a zone, never a state, carries a zone number; link plates are plain text", () => {
    for (const n of [...STATE_NAMES, ...WORST_NAMES]) {
      const m = model(n);
      assert.deepEqual(Object.keys(m.rail.link ?? {}).sort(), ["look", "text"].sort(), n);
      assert.ok(["quiet", "alert", "manual"].includes(m.rail.link?.look ?? "quiet"), n);
    }
  });

  it("the worst cases carry the longest content: an 80-character name steps the gel down", () => {
    assert.equal(model("worst-off-list").gel?.nameTier, "long");
    assert.equal(model("worst-paused").gel?.nameTier, "two");
    assert.equal(model("worst-running").clock?.count, "58:58");
    assert.deepEqual(model("worst-running").clock?.line, { kind: "bars", count: 2948, tail: "bars to the change" });
    assert.equal(model("worst-running").rail.left, "1:58:58");
    assert.equal(model("worst-before-start").intro?.zones.length, 7);
  });
});
