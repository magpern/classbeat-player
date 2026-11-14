// The web player page's pure rules (docs/design/play.md; ADR 0008): which class the address names,
// which documents the page runs, the picker's order and filter, when the wake lock is asked for, the
// notices, and the score's scale on a phone.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STATE_FIXTURES } from "../../src/fixtures/states.ts";
import { WORST_FIXTURES } from "../../src/fixtures/worst.ts";
import { isPlayableClass } from "../../src/play/doc-check.ts";
import { changedText, countText, fold, filtered, pageOf, sorted } from "../../src/play/picker-model.ts";
import type { Row } from "../../src/play/picker-model.ts";
import { classAddress, classIdOf } from "../../src/play/route.ts";
import { noticeOf, wakeAction } from "../../src/play/wake-policy.ts";
import { layoutScore, NOW_X, xAt } from "../../src/room/score.ts";
import { LANDSCAPE_SCALE, layoutOf, scaleFor } from "../../src/room/score-scale.ts";
import type { Class } from "../../src/room/input.ts";

const ID = "3f6d2c1a-8b4e-4f7a-9c2d-1e5a7b9c0d3f";
const OTHER = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

describe("the class the address names", () => {
  it("is a canonical lowercase UUID in the fragment, and nothing else", () => {
    assert.equal(classIdOf(`#${ID}`), ID);
    for (const bad of ["", "#", `#${ID.toUpperCase()}`, `#${ID.slice(0, -1)}`, `#${ID}x`, `#${ID}/`, `${ID}`, `#return=play.${ID}`, `#${ID}#${ID}`, `# ${ID}`, `#${ID} `, "#3f6d2c1a8b4e4f7a9c2d1e5a7b9c0d3f", "#control.BCDF-GHJK"]) {
      assert.equal(classIdOf(bad), null, JSON.stringify(bad));
    }
    assert.equal(classAddress(ID), `/play#${ID}`);
  });
});

describe("the documents the page runs", () => {
  it("accepts the recorded classes, and refuses a document of another shape", () => {
    assert.equal(isPlayableClass(STATE_FIXTURES.running.doc), true);
    assert.equal(isPlayableClass(WORST_FIXTURES["worst-running"].doc), true);
    const doc = STATE_FIXTURES.running.doc as Class;
    for (const bad of [null, "x", {}, { ...doc, intervals: [] }, { ...doc, class: { ...doc.class, length_ms: 1 } }, { ...doc, songs: "none" }, { ...doc, zone_scale: [{ zone: 1 }] }, { ...doc, intervals: [{ ...doc.intervals[0], start_ms: 5 }, ...doc.intervals.slice(1)] }]) {
      assert.equal(isPlayableClass(bad), false);
    }
  });
});

describe("the picker's rows", () => {
  const row = (id: string, title: string): Row => ({ id, title, lengthMs: 60_000, source: "classbeat", changedAt: "2026-11-02T09:00:00Z" });

  it("is title A to Z, case and accents ignored, equal titles by id; never by date", () => {
    const rows = [row("b", "Éclair"), row("a", "eclair"), row("c", "Zone"), row("d", "apple"), row("e", "Banana")];
    assert.deepEqual(sorted(rows).map((r) => r.id), ["d", "e", "a", "b", "c"]);
    assert.equal(fold("Éclair"), "eclair");
    const dated = [{ ...row("1", "B"), changedAt: "2026-01-01T00:00:00Z" }, { ...row("2", "A"), changedAt: "2020-01-01T00:00:00Z" }];
    assert.deepEqual(sorted(dated).map((r) => r.title), ["A", "B"]);
  });

  it("filters by part of a title, in the same order", () => {
    const rows = sorted([row("1", "Threshold builder"), row("2", "Recovery spin"), row("3", "Thursday threshold")]);
    assert.deepEqual(filtered(rows, "thresh").map((r) => r.id), ["1", "3"]);
    assert.deepEqual(filtered(rows, "  ").length, 3);
    assert.deepEqual(filtered(rows, "zzz"), []);
  });

  it("reads a page of GET classes: markers are not shown, a malformed page is refused, a cursor means more", () => {
    const entry = (over: object = {}) => ({ class_id: ID, source: "classbeat", title: "A", length_ms: 1000, changed_at: "2026-11-02T09:00:00Z", removed: false, ...over });
    const page = pageOf({ classes: [entry(), entry({ removed: true, title: "" }), entry({ class_id: "x", title: "B" }), entry({ class_id: OTHER, title: "C" })], cursor: "c1", more: true });
    assert.deepEqual(page?.rows.map((r) => r.title), ["A", "C"], "a marker is not shown, and nor is an id the page could not open");
    assert.equal(page?.next, "c1");
    assert.equal(pageOf({ classes: [], cursor: null, more: false })?.next, null);
    assert.equal(pageOf({ classes: [{ title: 3 }] }), null);
    assert.equal(pageOf({ nope: 1 }), null);
    assert.equal(pageOf(null), null);
  });

  it("counts and dates in words", () => {
    assert.deepEqual([1, 12].map(countText), ["1 class", "12 classes"]);
    const now = new Date(2026, 10, 14, 12);
    assert.equal(changedText(new Date(2026, 10, 14, 8).toISOString(), now), "Today");
    assert.equal(changedText(new Date(2026, 10, 13, 8).toISOString(), now), "Yesterday");
    assert.equal(changedText(new Date(2026, 7, 2, 8).toISOString(), now), "2 Aug");
    assert.equal(changedText(new Date(2025, 11, 14, 8).toISOString(), now), "14 Dec 2025");
    assert.equal(changedText("not a date", now), "");
  });
});

describe("keep-awake", () => {
  it("is asked for at Start and on Resume, held through pauses, released at the end, on End class and when hidden", () => {
    assert.deepEqual((["start", "resume"] as const).map((e) => wakeAction(e, "running")), ["ask", "ask"]);
    assert.deepEqual((["hidden", "ended", "close"] as const).map((e) => wakeAction(e, "running")), ["release", "release", "release"]);
    // A pause asks for nothing and releases nothing: there is no event for it.
  });

  it("is asked for again when the page is shown during a class, not before the start or after the end", () => {
    assert.equal(wakeAction("shown", "running"), "ask");
    assert.equal(wakeAction("shown", "paused"), "ask");
    assert.equal(wakeAction("shown", "ready"), "none");
    assert.equal(wakeAction("shown", "ended"), "none");
  });

  it("says so in the link slot for as long as it is refused while the class runs or is paused", () => {
    assert.equal(noticeOf("running", false, true), "screen-may-turn-off");
    assert.equal(noticeOf("paused", false, true), "screen-may-turn-off");
    assert.equal(noticeOf("running", false, false), null);
    assert.equal(noticeOf("ready", false, true), null, "no lock is asked for before Start");
    assert.equal(noticeOf("ended", false, true), null, "the lock is released at Class Complete");
  });

  it("says a reload happened until Start, and then no more", () => {
    assert.equal(noticeOf("ready", true, false), "reloaded");
    assert.equal(noticeOf("running", true, false), null);
  });
});

describe("the score's scale on each layout", () => {
  it("chooses the layout from the viewport alone", () => {
    assert.deepEqual([[1024, 768], [1280, 720], [844, 390], [640, 360], [719 + 800, 719], [390, 844], [768, 1024], [360, 640], [500, 500]].map(([w, h]) => layoutOf(w, h)), ["room", "room", "small-landscape", "small-landscape", "small-landscape", "portrait", "portrait", "portrait", "portrait"]);
  });

  it("is six minutes across on the room and the small landscape, three in portrait", () => {
    assert.equal(scaleFor(1024, 768), LANDSCAPE_SCALE);
    assert.ok(Math.abs(scaleFor(844, 390).vwPerS - 100 / 360) < 1e-9);
    const p = scaleFor(390, 844);
    assert.ok(Math.abs(p.vwPerS - 100 / 180) < 1e-9);
    // 45 s behind "now" and 2:15 ahead.
    assert.ok(Math.abs(xAt(-45_000, 0, p.vwPerS) - 0) < 1e-6);
    assert.ok(Math.abs(xAt(135_000, 0, p.vwPerS) - 100) < 1e-6);
    assert.equal(NOW_X, 25);
  });

  it("holds the sliver threshold at max(3 vw, 1.1 em of the block number) and keeps numbers inside the safe edge", () => {
    for (const [w, h] of [[390, 844], [360, 640], [768, 1024], [844, 390], [640, 360]] as const) {
      const s = scaleFor(w, h);
      const minorVh = h > w ? 3.1 : 5.5;
      assert.ok(s.minBlockW >= 3 && s.minBlockW >= (1.1 * minorVh * h) / w - 0.01, `${w}x${h}`);
      assert.ok(s.numberFitsUntil + s.minBlockW <= s.safeRight, `${w}x${h}: a number begun at the last place fits`);
    }
  });

  it("lays out a 30-second interval wide enough for its number in portrait, where six minutes would not", () => {
    const doc = STATE_FIXTURES.running.doc as Class;
    const input = (scale?: ReturnType<typeof scaleFor>) => layoutScore({ classMs: 0, lengthMs: doc.class.length_ms, intervals: doc.intervals, songs: doc.songs, zoneName: () => "n", ambiguity: null, unsure: false, scale });
    const portrait = input(scaleFor(390, 844));
    for (const b of portrait.blocks) assert.ok(b.left + b.width - Math.max(b.left, NOW_X) >= scaleFor(390, 844).minBlockW, "every drawn block holds its number");
    // Nothing begins right of the window: 2:15 ahead is the edge.
    assert.ok(portrait.blocks.every((b) => b.left <= 100));
  });
});
