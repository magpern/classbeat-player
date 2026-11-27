// Local playback between the controller's snapshots, the check before playing and the room's two
// <audio> (ADR 0017 section 3): checked before Start, all or nothing, a play id per sounding song,
// ended on stop, change, close and sign-out, and the audio stopped on any fault while the clock runs
// on by itself. A fake check, a fake room and a fake clock; no Electron, no files, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FindAnswer } from "../../src/core/music-files/answer.ts";
import type { LocalCue, LocalReport } from "../../src/core/music-files/local-cue.ts";
import { localPlayIdOf } from "../../src/core/music-files/local-scheme-policy.ts";
import type { Snapshot } from "../../src/core/snapshot.ts";
import { CHECK_TIMEOUT_MS, createLocalPlayer, RECHECK_MS } from "../../src/main/local/local-player.ts";
import { createLocalPlays } from "../../src/main/local/local-plays.ts";

const ACCT = "a".repeat(64);
const LEN = [110_000, 210_000, 500_000];
const songs = LEN.map((length_ms, k) => ({ title: `Song ${k + 1}`, artist: `Artist ${k + 1}`, start_ms: k * 100_000, end_ms: (k + 1) * 100_000, length_ms, ids: { local_file: { sha256: String(k + 1).repeat(64), size_bytes: 1_000 + k, file_name: `s${k}.mp3` } } }));
const DOC = { music: { source: "local", design_crossfade_ms: 6_000 }, class: { length_ms: 290_000 }, songs };

const done = (...s: Array<"found" | "missing">): FindAnswer => ({ status: "done", songs: s, limit_reached: false });

function rig(answer: FindAnswer = done("found", "found", "found"), doc: unknown = DOC) {
  let now = 0;
  const plays = createLocalPlays();
  const cues: LocalCue[] = [];
  const aligned: number[] = [];
  const checks: unknown[] = [];
  const r = {
    account: ACCT as string | null,
    room: 9 as number | null,
    answer: answer as FindAnswer | null,
    plays,
    cues,
    aligned,
    checks,
    /** While set, the check at Start does not answer until `open()` is called. */
    gate: null as Promise<void> | null,
    open: (): void => undefined,
    hold() {
      r.gate = new Promise<void>((ok) => void (r.open = () => ok()));
    },
    loadId: 1,
    tick: (ms: number) => (now += ms),
    now: () => now,
    last: () => cues[cues.length - 1]!,
    ids: (c: LocalCue = cues[cues.length - 1]!) => c.slots.map((s) => localPlayIdOf(s.url)),
    player: null as unknown as ReturnType<typeof createLocalPlayer>,
    snap(status: "ready" | "running" | "paused" | "ended", classMs: number) {
      r.player.snapshot({ loadId: r.loadId, doc, view: { status, classMs } } as unknown as Snapshot);
    },
    report(slot: 0 | 1, durationMs: number | null, extra: Partial<LocalReport> = {}) {
      r.player.report({ seq: r.last().seq, slot, positionMs: 0, playing: false, failed: false, durationMs, ...extra });
    },
    /** Start: the check runs again, and playing begins once it answers. */
    async start(classMs: number) {
      r.snap("running", classMs);
      await Promise.resolve();
      await Promise.resolve();
    },
    /** The check answers, and each song's length is reported twice (decoded lengths as given). */
    async ready(lengths: readonly number[] = LEN) {
      r.snap("ready", 0);
      await Promise.resolve();
      await Promise.resolve();
      for (const n of lengths) {
        r.snap("ready", 0);
        r.report(0, n);
        r.report(0, n);
      }
      r.snap("ready", 0);
    },
  };
  r.player = createLocalPlayer({
    plays,
    check: (d) => {
      checks.push(d);
      // The real check (main/music-files/service.ts) has no account to read after a sign-out and says "failed".
      const answer = (): FindAnswer | null => (r.account === null ? { status: "failed" } : r.answer);
      return r.gate === null ? Promise.resolve(answer()) : r.gate.then(answer);
    },
    account: () => r.account,
    roomId: () => r.room,
    cue: (c) => cues.push(c),
    align: (ms) => aligned.push(ms),
    now: () => now,
  });
  return r;
}

test("a class whose source is not local is no business of local playback", async () => {
  for (const source of ["spotify", "swedebeat", "none"]) {
    const r = rig(undefined, { ...DOC, music: { ...DOC.music, source } });
    r.snap("ready", 0);
    await Promise.resolve();
    r.snap("running", 0);
    r.tick(150_000);
    r.snap("running", 150_000);
    assert.equal(r.player.state(), null, source);
    assert.deepEqual([r.checks.length, r.cues.length, r.aligned.length], [0, 0, 0], source);
  }
});

test("before Start: one check for the open document, then each found file opened once, paused, for its length", async () => {
  const r = rig();
  r.snap("ready", 0);
  r.snap("ready", 0);
  assert.equal(r.checks.length, 1);
  assert.equal(r.checks[0], DOC);
  assert.deepEqual(r.player.state(), { kind: "checking" });
  await Promise.resolve();
  await Promise.resolve();
  r.snap("ready", 0);
  assert.deepEqual(r.player.state(), { kind: "ready" });
  assert.equal(r.last().playing, false);
  const [id] = r.ids();
  assert.ok(id !== null && r.plays.liveFrom(id!, 9)?.songIndex === 0);
  assert.equal(r.last().slots[1].url, null);
  // An early estimate is not a length: only two reports in a row that agree count.
  r.report(0, 50_000);
  r.report(0, LEN[0]!);
  assert.equal(r.plays.live(id!)?.songIndex, 0);
  r.report(0, LEN[0]!);
  assert.equal(r.plays.live(id!), null, "the probe's play ends once its length is known");
  r.snap("ready", 0);
  assert.equal(r.plays.live(r.ids()[0]!)?.songIndex, 1);
});

test("a check that found the shell busy is asked again, not before RECHECK_MS", async () => {
  const r = rig();
  r.answer = null;
  r.snap("ready", 0);
  await Promise.resolve();
  await Promise.resolve();
  r.snap("ready", 0);
  assert.equal(r.checks.length, 1);
  r.tick(RECHECK_MS);
  r.snap("ready", 0);
  assert.equal(r.checks.length, 2);
});

test("Start with every file found plays song 0 in slot 0; the overlap has both, each song ends at its stop", async () => {
  const r = rig();
  await r.ready();
  await r.start(0);
  assert.deepEqual(r.player.state(), { kind: "playing" });
  assert.equal(r.last().playing, true);
  const [a] = r.ids();
  assert.equal(r.plays.liveFrom(a!, 9)?.songIndex, 0);
  assert.equal(r.plays.liveFrom(a!, 10), null, "bound to the room window");
  r.tick(103_000);
  r.snap("running", 103_000);
  const [a2, b] = r.ids();
  assert.equal(a2, a);
  assert.equal(r.plays.live(b!)?.songIndex, 1);
  assert.deepEqual(r.last().slots.map((s) => s.positionMs), [103_000, 3_000]);
  assert.deepEqual(r.last().slots[1].fade, { inToMs: 6_000, outFromMs: 100_000, stopMs: 106_000 });
  r.tick(3_000);
  r.snap("running", 106_000);
  assert.equal(r.plays.live(a!), null, "song 0 stopped at end_ms + design_crossfade_ms");
  assert.deepEqual(r.ids(), [null, b]);
});

test("the owner's report steers the music time and the class clock follows it, beyond the 30 ms drift", async () => {
  const r = rig();
  await r.ready();
  await r.start(0);
  r.tick(10_000);
  r.report(0, LEN[0]!, { positionMs: 10_500, playing: true });
  r.snap("running", 10_000);
  assert.deepEqual(r.aligned, [10_500]);
  assert.deepEqual(r.player.link().latest(), { songIndex: 0, positionMs: 10_500, playing: true, at: 10_000 });
  // In the overlap, the outgoing song's report steers nothing (ADR 0001 rule 3).
  r.tick(92_500);
  r.snap("running", 103_000);
  r.report(0, LEN[0]!, { positionMs: 90_000, playing: true });
  r.snap("running", 103_000);
  assert.deepEqual(r.aligned, [10_500]);
});

test("one song missing, or a length two reports confirm wrong, is the manual clock: nothing plays", async () => {
  const missing = rig(done("found", "missing", "found"));
  await missing.ready([LEN[0]!, LEN[2]!]);
  const before = missing.cues.length;
  await missing.start(0);
  assert.deepEqual(missing.player.state(), { kind: "manual", reason: "missing", missing: [1] });
  missing.tick(150_000);
  missing.snap("running", 150_000);
  assert.ok(missing.cues.slice(before).every((c) => !c.playing && c.slots.every((s) => s.url === null)));
  const wrong = rig();
  await wrong.ready([LEN[0]!, LEN[1]! + 5_000, LEN[2]!]);
  await wrong.start(0);
  assert.deepEqual(wrong.player.state(), { kind: "manual", reason: "missing", missing: [1] });
  const unchecked = rig({ status: "failed" });
  await unchecked.ready([]);
  await unchecked.start(0);
  assert.deepEqual(unchecked.player.state(), { kind: "manual", reason: "not_checked" });
});

async function playing() {
  const r = rig();
  await r.ready();
  await r.start(0);
  r.tick(103_000);
  r.snap("running", 103_000);
  return r;
}
const silent = (c: LocalCue) => !c.playing && c.slots.every((s) => s.url === null);

test("a file that fails, a wrong length mid-class or a sign-out stops the audio at once; the clock runs on alone", async () => {
  const faults: Array<[string, (r: Awaited<ReturnType<typeof playing>>) => void]> = [
    ["scheme fault", (r) => r.player.fault(r.ids()[1]!)],
    ["element error", (r) => r.report(1, null, { failed: true })],
    ["wrong length", (r) => (r.report(1, 300_000), r.report(1, 300_000))],
    ["sign-out", (r) => ((r.account = null), r.snap("running", 103_000))],
    ["another account", (r) => ((r.account = "c".repeat(64)), r.snap("running", 103_000))],
  ];
  for (const [what, fault] of faults) {
    const r = await playing();
    const ids = r.ids();
    fault(r);
    r.snap("running", 103_000);
    assert.deepEqual(r.player.state(), { kind: "manual", reason: "failed" }, what);
    assert.ok(silent(r.last()), what);
    for (const id of ids) assert.equal(r.plays.live(id!), null, what);
    r.tick(50_000);
    const n = r.cues.length;
    r.snap("running", 153_000);
    assert.equal(r.cues.length, n, what);
    assert.deepEqual(r.aligned, [], what);
  }
});

test("plays end when the class ends, when another class opens and when the room window closes", async () => {
  const ended = await playing();
  const ids = ended.ids();
  ended.snap("ended", 290_000);
  for (const id of ids) assert.equal(ended.plays.live(id!), null);
  assert.ok(silent(ended.last()));
  const changed = await playing();
  const cids = changed.ids();
  changed.loadId = 2;
  changed.snap("ready", 0);
  for (const id of cids) assert.equal(changed.plays.live(id!), null);
  const closed = await playing();
  const wids = closed.ids();
  closed.room = null;
  closed.player.roomClosed(9);
  for (const id of wids) assert.equal(closed.plays.live(id!), null);
  // A new room window gets new plays, bound to it.
  closed.room = 11;
  closed.tick(1_000);
  closed.snap("running", 104_000);
  const [x, y] = closed.ids();
  assert.ok(x !== null && y !== null && !wids.includes(x) && !wids.includes(y));
  assert.equal(closed.plays.liveFrom(x!, 11)?.songIndex, 0);
});

test("Start after a sign-out is the manual clock (failed), not a silent \"playing\" (#946 item 1)", async () => {
  const r = rig();
  await r.ready();
  r.account = null;
  await r.start(0);
  assert.deepEqual(r.player.state(), { kind: "manual", reason: "failed" });
  const n = r.cues.length;
  r.tick(5_000);
  r.snap("running", 5_000);
  assert.equal(r.cues.length, n, "no cue goes out with a snapshot");
  assert.ok(r.cues.every((c) => !c.playing));
});

test("Start runs the check again: a file that went missing since the class opened is the manual clock (#946 item 2)", async () => {
  const r = rig();
  await r.ready();
  assert.equal(r.checks.length, 1);
  r.answer = done("found", "missing", "found");
  r.snap("running", 0);
  assert.deepEqual(r.player.state(), { kind: "checking" }, "nothing plays until the second check answers");
  assert.ok(r.cues.every((c) => !c.playing));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(r.checks.length, 2);
  assert.deepEqual(r.player.state(), { kind: "manual", reason: "missing", missing: [1] });
  assert.ok(r.cues.every((c) => !c.playing));
  // A second check that is busy is not a pass either: it waits and asks again (and ends as not_checked after CHECK_TIMEOUT_MS, below).
  const busy = rig();
  await busy.ready();
  busy.answer = null;
  await busy.start(0);
  assert.deepEqual(busy.player.state(), { kind: "checking" });
  assert.ok(busy.cues.every((c) => !c.playing));
});

test("Start waits for the second check, then plays from the class time reached meanwhile (#946 item 2)", async () => {
  const r = rig();
  await r.ready();
  r.snap("running", 0);
  r.tick(1_000);
  r.snap("running", 1_000);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(r.player.state(), { kind: "playing" });
  assert.equal(r.last().playing, true);
  assert.equal(r.last().slots[0].positionMs, 1_000);
});

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

test("another class opening while the check at Start runs: nothing plays for it, and the old answer does not touch it (#946)", async () => {
  const r = rig();
  await r.ready();
  r.hold();
  r.snap("running", 0);
  r.loadId = 2;
  r.snap("ready", 0);
  const n = r.cues.length;
  r.open();
  await settle();
  assert.equal(r.cues.length, n, "no cue for the class whose check has not answered");
  assert.ok(r.cues.every((c) => !c.playing));
  assert.deepEqual(r.player.state(), { kind: "checking" });
});

test("a class that ends while the check at Start runs never plays (#946)", async () => {
  const r = rig();
  await r.ready();
  r.hold();
  r.snap("running", 0);
  r.tick(5_000);
  r.snap("ended", 290_000);
  const n = r.cues.length;
  r.open();
  await settle();
  assert.equal(r.player.state(), null);
  assert.equal(r.cues.length, n);
  assert.ok(r.cues.every((c) => !c.playing));
});

test("a pause during the check at Start joins paused, at the paused class time (#946)", async () => {
  const r = rig();
  await r.ready();
  r.hold();
  r.snap("running", 0);
  r.tick(2_000);
  r.snap("paused", 2_000);
  r.tick(30_000);
  r.open();
  await settle();
  assert.deepEqual(r.player.state(), { kind: "playing" });
  assert.equal(r.last().playing, false);
  assert.equal(r.last().slots[0].positionMs, 2_000, "not advanced by the time spent paused");
});

test("a check at Start that never answers is the manual clock, not a silent \"checking\" for the whole class (#946)", async () => {
  const r = rig();
  await r.ready();
  r.hold();
  r.snap("running", 0);
  r.tick(CHECK_TIMEOUT_MS - 1_000);
  r.snap("running", CHECK_TIMEOUT_MS - 1_000);
  assert.deepEqual(r.player.state(), { kind: "checking" });
  r.tick(2_000);
  r.snap("running", CHECK_TIMEOUT_MS + 1_000);
  assert.deepEqual(r.player.state(), { kind: "manual", reason: "not_checked" });
  // A late answer changes nothing.
  r.open();
  await settle();
  assert.deepEqual(r.player.state(), { kind: "manual", reason: "not_checked" });
  assert.ok(r.cues.every((c) => !c.playing));
});

test("the presenter's notice names the song that failed and why, never a path; a sign-out names no song (#922)", async () => {
  const playingNow = await playing();
  assert.equal(playingNow.player.notice(), null, "while the files play there is nothing to say");
  const stopped = { headline: "The music stopped", line: "Manual clock, music stopped" };
  const cases: Array<[string, (r: Awaited<ReturnType<typeof playing>>) => void, string | null, string]> = [
    ["scheme fault", (r) => r.player.fault(r.ids()[1]!), "Song 2 could not be played", "Song 2 could not be read. The clock keeps running."],
    ["element error", (r) => r.report(1, null, { failed: true }), "Song 2 could not be played", "Song 2 could not be read. The clock keeps running."],
    ["wrong length", (r) => (r.report(1, 300_000), r.report(1, 300_000)), "Song 2 is the wrong length", "Song 2 is the wrong length. The clock keeps running."],
    ["sign-out", (r) => ((r.account = null), r.snap("running", 103_000)), null, "The clock keeps running."],
  ];
  for (const [what, fault, detail, body] of cases) {
    const r = await playing();
    fault(r);
    r.snap("running", 103_000);
    assert.deepEqual(r.player.notice(), { line: stopped.line, detail, plate: { headline: stopped.headline, body } }, what);
    assert.doesNotMatch(JSON.stringify(r.player.notice()), /s\d\.mp3|sha|[/\\]/i, what);
  }
});

test("a check at Start that finds the files service busy is asked again when it is free, not called not_checked (#922)", async () => {
  const r = rig();
  await r.ready();
  r.answer = null;
  await r.start(0);
  assert.deepEqual(r.player.state(), { kind: "checking" }, "waiting, not failed");
  r.answer = done("found", "found", "found");
  r.tick(RECHECK_MS);
  r.snap("running", RECHECK_MS);
  await Promise.resolve();
  await Promise.resolve();
  r.snap("running", RECHECK_MS);
  assert.deepEqual(r.player.state(), { kind: "playing" });
  // Busy for good: a defined outcome after CHECK_TIMEOUT_MS.
  const stuck = rig();
  await stuck.ready();
  stuck.answer = null;
  await stuck.start(0);
  for (let t = RECHECK_MS; t <= CHECK_TIMEOUT_MS + RECHECK_MS; t += RECHECK_MS) {
    stuck.tick(RECHECK_MS);
    stuck.snap("running", t);
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.deepEqual(stuck.player.state(), { kind: "manual", reason: "not_checked" });
});

test("the manual state and its notice end with the class (#922)", async () => {
  const r = await playing();
  r.player.fault(r.ids()[1]!);
  r.snap("running", 103_000);
  assert.notEqual(r.player.notice(), null);
  r.snap("ended", 290_000);
  assert.equal(r.player.notice(), null, "the plate closes as the class ends");
  assert.equal(r.player.state(), null);
  const missing = rig(done("found", "missing", "found"));
  await missing.ready([LEN[0]!, LEN[2]!]);
  await missing.start(0);
  assert.notEqual(missing.player.notice(), null);
  missing.snap("ended", 290_000);
  assert.equal(missing.player.notice(), null);
});

test("a class started with files missing, or not checked, says so on the presenter with no plate (#922)", async () => {
  const missing = rig(done("found", "missing", "found"));
  await missing.ready([LEN[0]!, LEN[2]!]);
  await missing.start(0);
  assert.deepEqual(missing.player.notice(), { line: "Manual clock", detail: "1 music file was missing when the class started", plate: null });
  const unchecked = rig({ status: "failed" });
  await unchecked.ready([]);
  await unchecked.start(0);
  assert.deepEqual(unchecked.player.notice(), { line: "Manual clock", detail: "The music files could not be checked when the class started", plate: null });
  const other = rig(undefined, { ...DOC, music: { ...DOC.music, source: "spotify" } });
  other.snap("ready", 0);
  assert.equal(other.player.notice(), null, "a class that is not local has no notice");
});
