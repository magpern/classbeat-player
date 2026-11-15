// The replay over a recorded fake Android log: spike 1's follower, spike 1's table.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildPlan } from "../../../music-follower/src/core/class_plan.js";
import { parseLog } from "../src/log.js";
import { replay } from "../src/replay.js";
import { formatTable, passTable, spans } from "../src/table.js";
import { fakeLog } from "./fake_log.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const classFile = here("../../../music-follower/example/class.spike.json");
const logFile = here("./fixtures/android-fake.jsonl");
const plan = buildPlan(JSON.parse(readFileSync(classFile, "utf8")));
const log = parseLog(readFileSync(logFile, "utf8"));
const replayed = replay(plan, log);

describe("the recorded fake log", () => {
  it("is what the generator writes", () => {
    assert.equal(readFileSync(logFile, "utf8"), fakeLog());
  });

  it("parses, and keeps spike 1's reading shape", () => {
    const first = log.find((l) => l.t === "reading" && l.reading)!;
    assert.equal(first.reading!.source, "android-media-session");
    assert.equal(first.reading!.trackId, "spotify:track:SPIKEEXAMPLE0001");
    assert.ok(log.some((l) => l.t === "marker") && log.some((l) => l.t === "control"));
  });

  it("is rejected when a line is damaged", () => {
    assert.throws(() => parseLog("{not json}"), /line 1: not JSON/);
    assert.throws(() => parseLog('{"t":"reading","monoMs":1,"wallMs":2}'), /no reading/);
    assert.throws(() => parseLog('{"t":"reading","monoMs":1,"wallMs":2,"reading":{"title":"a"}}'), /needs title and artist|artist/);
    assert.throws(() => parseLog('{"t":"meta","monoMs":5,"wallMs":1}\n{"t":"meta","monoMs":4,"wallMs":1}'), /backwards/);
  });
});

describe("the replay", () => {
  it("runs spike 1's follower: locks, pauses, coasts, goes off the list and changes song", () => {
    const states = new Set(replayed.steps.map((s) => s.decision.state));
    for (const st of ["Locked", "Paused", "Coasting", "Off the list"] as const) assert.ok(states.has(st), st);
    assert.ok(replayed.steps.some((s) => s.decision.event === "song_change" && s.decision.songIndex === 1));
  });

  it("applies the log's undo and relink controls, and gives markers a class time", () => {
    assert.deepEqual(replayed.decisions.filter((d) => d.kind !== "reading").map((d) => d.kind), ["undo", "relink"]);
    assert.equal(replayed.markers.length, 2);
    assert.ok(replayed.markers.every((m) => m.classTimeMs !== null && m.classTimeMs > 5000));
  });

  it("writes spike 1's log shape with a decision on every reading", () => {
    const lines = replayed.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const readings = lines.filter((l) => l["t"] === "reading");
    assert.equal(readings.length, 393);
    assert.ok(readings.every((l) => typeof (l["decision"] as { state?: string }).state === "string"));
    assert.ok(lines.some((l) => l["t"] === "control" && (l["decision"] as { event: string }).event === "undo"));
    assert.equal(lines[0]!["t"], "meta");
  });

  it("finds the spans of each state in order", () => {
    const sp = spans(replayed);
    assert.equal(sp[0]!.state, "Locked");
    assert.ok(sp.some((x) => x.state === "Coasting" && x.toMs - x.fromMs > 25_000));
  });
});

describe("spike 1's pass table", () => {
  const rows = passTable(plan, replayed);

  it("has the ten rows of plan section 12 in order", () => {
    assert.deepEqual(rows.map((r) => r.what), [
      "Interval timing",
      "Song changes",
      "Pause and resume, seek, next and previous",
      "The same recording twice in one class",
      "A song that is not in the class; an advert; another app playing",
      "The music app closed and restarted; readings going stale",
      "Readings lost while the music is paused for 30 s, then restored",
      "Readings lost while the music keeps playing for 30 s, then restored",
      "An hour of play",
      "Beat effects (measured separately)",
    ]);
  });

  it("decides the rows the log decides, and leaves the rest to the recording", () => {
    assert.equal(rows[0]!.verdict, "PASS");
    assert.match(rows[0]!.detail, /100\.0 % of \d+ locked polls/);
    assert.match(rows[1]!.detail, /1 changes seen/);
    assert.match(rows[4]!.detail, /Off the list spans 1 \(6\.0 s\)/);
    assert.match(rows[5]!.detail, /stale readings applied as current: 0/);
    assert.match(rows[6]!.detail, /undo pressed 1, relink 1/);
    assert.match(rows[9]!.detail, /1 beat taps/);
    assert.equal(rows[8]!.verdict, "CHECK");
  });

  it("fails interval timing when no reading matches the class", () => {
    const wrong = buildPlan({ crossfadeMs: 9000, songs: [{ trackId: "spotify:track:NOPE", title: "Other", artist: "Other", durationMs: 100_000 }] });
    const r = passTable(wrong, replay(wrong, log));
    assert.equal(r[0]!.verdict, "FAIL");
  });

  it("prints one line per row", () => {
    assert.equal(formatTable(rows).split("\n").length, 10);
  });
});

describe("the command line", () => {
  it("prints the table and writes the replayed log", () => {
    const out = join(mkdtempSync(join(tmpdir(), "replay-")), "replayed.jsonl");
    const text = execFileSync(process.execPath, ["--import", "tsx", here("../src/cli.ts"), "--class", classFile, "--log", logFile, "--out", out], { cwd: here(".."), encoding: "utf8" });
    assert.match(text, /PASS\s+Interval timing/);
    assert.match(text, /CHECK\s+Beat effects/);
    assert.equal(readFileSync(out, "utf8").trim().split("\n").length, replayed.lines.length);
  });

  it("exits with usage when an argument is missing", () => {
    assert.throws(() => execFileSync(process.execPath, ["--import", "tsx", here("../src/cli.ts")], { cwd: here(".."), stdio: "pipe" }), /usage|status 2/);
  });
});
