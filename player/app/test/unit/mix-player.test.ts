// Mix playback between the controller, the cache and the room's <audio> (main/mix/mix-player.ts),
// with a fake cache and a fake room: the download starts when the class opens, Start plays while
// it downloads, the reports steer the clock, and a fault falls back to the manual clock with the reason.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { MixCue } from "../../src/core/mix/audio-cue.ts";
import type { Snapshot } from "../../src/core/snapshot.ts";
import { MIX_DISABLED } from "../../src/core/mix/view.ts";
import type { MixView } from "../../src/core/mix/view.ts";
import type { CacheOutcome } from "../../src/main/mix/mix-cache.ts";
import {
  createMixPlayer,
  JUMP_MS,
  UNANSWERED_MS,
} from "../../src/main/mix/mix-player.ts";
import type { MixPlayerDeps } from "../../src/main/mix/mix-player.ts";
import type { MixReader } from "../../src/main/mix/mix-reader.ts";
import { createPlays } from "../../src/main/mix/plays.ts";
import { RETRY_MS } from "../../src/main/mix/open-download.ts";
import type { NamedMixes } from "../../src/main/sync/service.ts";

const A = "a".repeat(64);
const SIGNED_IN: MixView = { ...MIX_DISABLED, state: "signed_in" };
const music = (id = "mix_1", offset = 0) => ({
  source: "swedebeat",
  swedebeat_mix: { id, length_ms: 60_000, offset_ms: offset },
});
const snap = (
  loadId: number,
  status: string | null,
  classMs = 0,
  m: unknown = music(),
): Snapshot =>
  ({
    loadId,
    doc: { music: m, class: { length_ms: 60_000 } },
    view: status === null ? null : { status, classMs },
  }) as unknown as Snapshot;

function rig(
  o: {
    view?: MixView;
    outcome?: Promise<CacheOutcome>;
    complete?: boolean;
    room?: number | null;
    listed?: readonly string[];
    named?: NamedMixes | null;
  } = {},
) {
  let t = 0;
  const cues: MixCue[] = [];
  const aligned: number[] = [];
  const log: string[] = [];
  let settle: (o: CacheOutcome) => void = () => undefined;
  const outcome = o.outcome ?? new Promise<CacheOutcome>((r) => (settle = r));
  const reader = (complete: boolean): MixReader => ({
    byteLength: 10,
    chunks: 4,
    complete,
    chunkLength: () => 1,
    readChunk: () => Promise.resolve({ ok: false, reason: "pending" }),
    written: () => Promise.resolve(1),
  });
  let complete = o.complete ?? false;
  let room: number | null = o.room === undefined ? 9 : o.room;
  const plays = createPlays();
  let view = o.view ?? SIGNED_IN;
  const cache: MixPlayerDeps["cache"] = {
    download: (a, m, opts) => {
      log.push(`download ${a === A} ${m} ${JSON.stringify(opts)}`);
      return outcome;
    },
    open: () => reader(complete),
    played: (_a, m) => void log.push(`played ${m}`),
    evict: (_a, opts) => {
      log.push(`evict ${JSON.stringify(opts)}`);
      return Promise.resolve(0);
    },
  };
  const player = createMixPlayer({
    cache,
    plays,
    view: () => view,
    account: () => A,
    roomId: () => room,
    cue: (c) => void cues.push(c),
    align: (ms) => void aligned.push(ms),
    now: () => t,
    listed: () => o.listed ?? [],
    named: () => o.named ?? null,
  });
  return {
    player,
    plays,
    cues,
    aligned,
    log,
    settle: (x: CacheOutcome) => settle(x),
    advance: (ms: number) => (t += ms),
    setComplete: (c: boolean) => (complete = c),
    setRoom: (r: number | null) => (room = r),
    setView: (v: MixView) => (view = v),
    flush: () => new Promise((r) => setImmediate(r)),
  };
}

test("a class without a mix: nothing downloads, no cue, no line", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready", 0, { source: "spotify" }));
  r.player.snapshot(snap(1, "running", 0, { source: "spotify" }));
  assert.equal(r.player.line(), null);
  assert.deepEqual(r.cues, []);
  assert.deepEqual(r.log, ['evict {"keep":[],"pinned":[]}']);
});

test("opening a mix class starts its download, keeping that mix; the line shows the progress", async () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  assert.deepEqual(r.log, ['evict {"keep":[],"pinned":["mix_1"]}', 'download true mix_1 {"keep":[]}']);
  await r.flush();
  r.advance(1_000);
  r.player.snapshot(snap(1, "ready"));
  assert.deepEqual(r.player.line(), {
    text: "Downloading the mix 25%",
    shape: "circle",
  });
});

test("Start while it downloads plays the mix at once: a play bound to the room window, cued at the class time", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  assert.equal(r.cues.length, 1);
  const c = r.cues[0]!;
  assert.match(c.url!, /^cbp-mix:\/\/play\/[0-9a-f]{32}$/);
  assert.equal(c.playing, true);
  assert.equal(c.positionMs, 0);
  const id = c.url!.slice("cbp-mix://play/".length);
  assert.ok(r.plays.liveFrom(id, 9), "bound to the room window");
  assert.equal(r.plays.liveFrom(id, 1), null, "and to no other");
  assert.ok(r.log.includes("played mix_1"));
  assert.deepEqual(r.player.line(), { text: "Playing the mix", shape: "dot" });
});

test("the offset: the audio is cued at class time + offset_ms, and steered back by it", () => {
  const r = rig({ complete: true });
  r.player.snapshot(snap(1, "ready", 0, music("mix_1", 5_000)));
  assert.deepEqual(r.player.line(), { text: "Mix ready", shape: "dot" });
  r.player.snapshot(snap(1, "running", 0, music("mix_1", 5_000)));
  assert.equal(r.cues[0]!.positionMs, 5_000);
  r.advance(1_000);
  r.player.report({
    seq: r.cues[0]!.seq,
    positionMs: 7_000,
    playing: true,
    failed: false,
    durationMs: null,
  });
  assert.deepEqual(r.aligned, [2_000]);
});

test("the reports steer the running clock past the drift only, and a late report is dropped", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  const seq = r.cues[0]!.seq;
  r.advance(1_000);
  r.player.report({ seq, positionMs: 1_030, playing: true, failed: false, durationMs: null });
  assert.deepEqual(r.aligned, [], "within the drift");
  r.player.report({ seq, positionMs: 1_600, playing: true, failed: false, durationMs: null });
  assert.deepEqual(r.aligned, [1_600]);
  r.player.report({
    seq: seq - 1,
    positionMs: 9_000,
    playing: true,
    failed: false,
    durationMs: null,
  });
  r.player.report({
    seq: seq + 1,
    positionMs: 9_000,
    playing: true,
    failed: false,
    durationMs: null,
  });
  assert.deepEqual(r.aligned, [1_600], "only the current cue's reports");
});

test("pause, resume and a jump cue the audio; time passing does not", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  r.player.report({
    seq: r.cues[0]!.seq,
    positionMs: 0,
    playing: true,
    failed: false,
    durationMs: null,
  });
  r.advance(500);
  r.player.snapshot(snap(1, "running", 500));
  assert.equal(r.cues.length, 1);
  r.player.snapshot(snap(1, "paused", 500));
  assert.deepEqual(
    [r.cues.at(-1)!.playing, r.cues.at(-1)!.positionMs],
    [false, 500],
  );
  r.player.report({
    seq: r.cues.at(-1)!.seq,
    positionMs: 500,
    playing: false,
    failed: false,
    durationMs: null,
  });
  r.player.snapshot(snap(1, "running", 500));
  assert.deepEqual(
    [r.cues.at(-1)!.playing, r.cues.at(-1)!.positionMs],
    [true, 500],
  );
  r.player.report({
    seq: r.cues.at(-1)!.seq,
    positionMs: 500,
    playing: true,
    failed: false,
    durationMs: null,
  });
  const n = r.cues.length;
  r.advance(100);
  r.player.snapshot(snap(1, "running", 600 + JUMP_MS + 5_000));
  assert.equal(r.cues.length, n + 1, "a jump");
  assert.equal(r.cues.at(-1)!.positionMs, 600 + JUMP_MS + 5_000);
  assert.equal(new Set(r.cues.map((c) => c.url)).size, 1, "the same play");
});

test("a cue the room does not answer is sent again", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  r.advance(UNANSWERED_MS + 1);
  r.player.snapshot(snap(1, "running", UNANSWERED_MS + 1));
  assert.equal(r.cues.length, 2);
  assert.ok(r.cues[1]!.seq > r.cues[0]!.seq);
});

test("a stream fault falls back to the manual clock with the short reason, and the audio is emptied", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  const id = r.cues[0]!.url!.slice("cbp-mix://play/".length);
  r.player.fault("f".repeat(32), "downloading");
  assert.deepEqual(
    r.player.line(),
    { text: "Playing the mix", shape: "dot" },
    "another play's fault is ignored",
  );
  r.player.fault(id, "downloading");
  assert.deepEqual(r.player.line(), {
    text: "Mix still downloading",
    shape: "news",
  });
  assert.equal(r.plays.live(id), null, "the play ended");
  assert.deepEqual(r.cues.at(-1), {
    seq: r.cues.at(-1)!.seq,
    url: null,
    playing: false,
    positionMs: 0,
  });
  r.advance(30_000);
  assert.deepEqual(r.player.line(), { text: "Manual clock", shape: "square" });
  r.player.snapshot(snap(1, "running", 30_000));
  assert.equal(r.cues.at(-1)!.url, null, "no new play after a fall back");
});

test("the audio failing in the room falls back: not checked", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  r.player.report({
    seq: r.cues[0]!.seq,
    positionMs: 0,
    playing: false,
    failed: true,
    durationMs: null,
  });
  assert.deepEqual(r.player.line(), { text: "Mix not checked", shape: "news" });
});

test("sign-out mid-class ends the play: the next snapshot falls back, saying signed out", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  r.setView({ ...SIGNED_IN, state: "signed_out" });
  r.plays.endAccount(A);
  r.player.snapshot(snap(1, "running", 100));
  assert.deepEqual(r.player.line(), {
    text: "Signed out of Swedebeat",
    shape: "news",
  });
});

test("a play ended elsewhere while still signed in falls back: not checked", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  r.plays.endAccount(A);
  r.player.snapshot(snap(1, "running", 100));
  assert.deepEqual(r.player.line(), { text: "Mix not checked", shape: "news" });
});

test("not signed in, or the source refused the mix: the manual clock with the full reason before the start", async () => {
  const off = rig({ view: { ...SIGNED_IN, state: "signed_out" } });
  off.player.snapshot(snap(1, "ready"));
  assert.deepEqual(off.player.line(), {
    text: "Press Start · Swedebeat is not connected",
    shape: "square",
  });
  assert.ok(!off.log.some((l) => l.startsWith("download")), "no download");
  off.player.snapshot(snap(1, "running", 0));
  assert.deepEqual(off.cues, []);
  assert.deepEqual(off.player.line(), {
    text: "Manual clock",
    shape: "square",
  });

  const refused = rig({ outcome: Promise.resolve("not_allowed") });
  refused.player.snapshot(snap(1, "ready"));
  await refused.flush();
  refused.player.snapshot(snap(1, "ready"));
  assert.deepEqual(refused.player.line(), {
    text: "Press Start · This account cannot play this mix",
    shape: "square",
  });
  for (const o of ["bad", "not_found", "too_large"] as const) {
    const r = rig({ outcome: Promise.resolve(o) });
    r.player.snapshot(snap(1, "ready"));
    await r.flush();
    r.player.snapshot(snap(1, "ready"));
    assert.deepEqual(
      r.player.line(),
      { text: "Press Start · The mix could not be checked", shape: "square" },
      o,
    );
  }
});

test("a download that stopped before it finished: Start runs on the manual clock, still downloading", async () => {
  const r = rig({ outcome: Promise.resolve("interrupted") });
  r.player.snapshot(snap(1, "ready"));
  await r.flush();
  r.player.snapshot(snap(1, "running", 0));
  assert.deepEqual(r.cues, []);
  assert.deepEqual(r.player.line(), { text: "Manual clock", shape: "square" });
});

test("the room window closed: its play ends; reopened, a new play is cued to the new window", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  const first = r.cues[0]!.url!;
  r.player.roomClosed(9);
  assert.equal(r.plays.live(first.slice(-32)), null);
  r.setRoom(12);
  r.player.snapshot(snap(1, "running", 100));
  const next = r.cues.at(-1)!;
  assert.notEqual(next.url, first);
  assert.ok(r.plays.liveFrom(next.url!.slice(-32), 12));
  assert.equal(r.plays.liveFrom(next.url!.slice(-32), 9), null);
});

test("the class ends: the audio stops, the mix is kept from eviction, the line goes", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  const id = r.cues[0]!.url!.slice(-32);
  r.player.snapshot(snap(1, "ended", 60_000));
  assert.equal(r.plays.live(id), null);
  assert.equal(r.cues.at(-1)!.url, null);
  assert.equal(r.log.at(-1), 'evict {"keep":[],"pinned":["mix_1"]}');
  assert.equal(r.player.line(), null);
});

test("another class opens: the play ends and the old mix may be evicted, the new one kept", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  const id = r.cues[0]!.url!.slice(-32);
  r.player.snapshot(snap(2, "ready", 0, music("mix_2")));
  assert.equal(r.plays.live(id), null);
  assert.equal(r.cues.at(-1)!.url, null);
  assert.ok(r.log.includes('evict {"keep":[],"pinned":["mix_2"]}'));
  assert.ok(r.log.includes('download true mix_2 {"keep":[]}'));
});

test("a download that did not complete is started again after RETRY_MS, while signed in", async () => {
  const r = rig({ outcome: Promise.resolve("interrupted") });
  const downloads = () => r.log.filter((l) => l.startsWith("download")).length;
  r.player.snapshot(snap(1, "ready"));
  await r.flush();
  r.advance(RETRY_MS - 1);
  r.player.snapshot(snap(1, "ready"));
  assert.equal(downloads(), 1, "not yet");
  r.advance(1);
  r.setView({ ...SIGNED_IN, state: "signed_out" });
  r.player.snapshot(snap(1, "ready"));
  assert.equal(downloads(), 1, "not while signed out");
  r.setView(SIGNED_IN);
  r.player.snapshot(snap(1, "ready"));
  assert.equal(downloads(), 2, "again");
  const refused = rig({ outcome: Promise.resolve("not_found") });
  refused.player.snapshot(snap(1, "ready"));
  await refused.flush();
  refused.advance(RETRY_MS * 3);
  refused.player.snapshot(snap(1, "ready"));
  assert.equal(refused.log.filter((l) => l.startsWith("download")).length, 1, "a final refusal is not retried");
});

test("a decoded length more than 1 000 ms from length_ms is not used: not checked", () => {
  for (const [durationMs, kept] of [[61_000, true], [59_000, true], [61_001, false], [58_999, false], [null, true]] as const) {
    const r = rig();
    r.player.snapshot(snap(1, "ready"));
    r.player.snapshot(snap(1, "running", 0));
    r.player.report({ seq: r.cues[0]!.seq, positionMs: 0, playing: true, failed: false, durationMs });
    assert.deepEqual(r.player.line(), { text: "Playing the mix", shape: "dot" }, `${durationMs}: one report is not confirmed`);
    r.player.report({ seq: r.cues[0]!.seq, positionMs: 0, playing: true, failed: false, durationMs });
    assert.deepEqual(
      r.player.line(),
      kept ? { text: "Playing the mix", shape: "dot" } : { text: "Mix not checked", shape: "news" },
      String(durationMs),
    );
    if (!kept) assert.equal(r.cues.at(-1)!.url, null, "the audio is emptied");
  }
});

test("an early wrong length the next report revises is not acted on", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  const seq = r.cues[0]!.seq;
  for (const durationMs of [30_000, 60_000, 60_000, 90_000, 60_000]) r.player.report({ seq, positionMs: 0, playing: true, failed: false, durationMs });
  assert.deepEqual(r.player.line(), { text: "Playing the mix", shape: "dot" });
  r.player.report({ seq, positionMs: 0, playing: true, failed: false, durationMs: 90_000 });
  r.player.report({ seq, positionMs: 0, playing: true, failed: false, durationMs: 90_000 });
  assert.deepEqual(r.player.line(), { text: "Mix not checked", shape: "news" }, "a wrong length that holds falls back");
});

test("the clock is never steered past the class's end, nor below 0", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  r.advance(1_000);
  r.player.report({ seq: r.cues[0]!.seq, positionMs: 90_000, playing: true, failed: false, durationMs: null });
  assert.deepEqual(r.aligned, [60_000], "the class is 60 000 ms long");
  const late = rig({ complete: true });
  late.player.snapshot(snap(1, "ready", 0, music("mix_1", 5_000)));
  late.player.snapshot(snap(1, "running", 0, music("mix_1", 5_000)));
  late.advance(1_000);
  late.player.report({ seq: late.cues[0]!.seq, positionMs: 1_000, playing: true, failed: false, durationMs: null });
  assert.deepEqual(late.aligned, [0]);
});

test("eviction pins the open class's mix and keeps every mix the synced classes name", () => {
  const r = rig({ listed: ["mix_0", "mix_9"] });
  assert.equal(r.player.openMix(), null);
  r.player.snapshot(snap(1, "ready"));
  assert.deepEqual(r.log, ['evict {"keep":["mix_0","mix_9"],"pinned":["mix_1"]}', 'download true mix_1 {"keep":["mix_0","mix_9"]}']);
  assert.equal(r.player.openMix(), "mix_1");
  r.player.snapshot(snap(2, "ready", 0, { source: "spotify" }));
  assert.equal(r.player.openMix(), null);
});

test("a mix no class names is deleted only with a complete synced list of the same account", () => {
  const full = rig({ listed: ["mix_0"], named: { account: A, mixes: ["mix_0"] } });
  full.player.snapshot(snap(1, "ready"));
  assert.equal(full.log[0], 'evict {"keep":["mix_0"],"pinned":["mix_1"],"named":["mix_0"]}');
  // Not complete (a sync running, a wipe waiting, nothing named): nothing goes for not being named.
  const partial = rig({ listed: ["mix_0"], named: null });
  partial.player.snapshot(snap(1, "ready"));
  assert.equal(partial.log[0], 'evict {"keep":["mix_0"],"pinned":["mix_1"]}');
  // Another account's list never sweeps this account's cache.
  const other = rig({ listed: ["mix_0"], named: { account: "b".repeat(64), mixes: ["mix_0"] } });
  other.player.snapshot(snap(1, "ready"));
  assert.equal(other.log[0], 'evict {"keep":["mix_0"],"pinned":["mix_1"]}');
});

// ADR 0013 section 4: interval timing within about 1 s and beat effects within 50 ms (ADR 0001),
// met by construction and checked on the fake. The audio here runs 0.2 % fast and starts 300 ms
// late, the controller's snapshots come every 250 ms, and each report is 10 ms old when it arrives.
test("accuracy on the fake: the class clock stays within 50 ms of the audio after the first report", () => {
  const r = rig({ complete: true });
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  const RATE = 1.002;
  const LATE = 300;
  const AGE = 10;
  const audioAt = (t: number) => Math.max(0, (t - LATE) * RATE);
  let base = 0;
  let at = 0;
  let worst = 0;
  let worstAfter = 0;
  for (let t = 1; t <= 55_000; t += 1) {
    r.advance(1);
    const n = r.aligned.length;
    if (t % 1_000 === 0) r.player.report({ seq: r.cues.at(-1)!.seq, positionMs: Math.round(audioAt(t - AGE)), playing: true, failed: false, durationMs: 60_000 });
    if (r.aligned.length > n) {
      base = r.aligned.at(-1)!;
      at = t;
    }
    const classMs = base + (t - at);
    if (t % 250 === 0) r.player.snapshot(snap(1, "running", classMs));
    const err = Math.abs(classMs - audioAt(t));
    if (t > LATE) worst = Math.max(worst, err);
    if (t > 1_000) worstAfter = Math.max(worstAfter, err);
  }
  assert.ok(worst <= 1_000, `interval timing: ${worst}`);
  assert.ok(worstAfter <= 50, `beat effects: ${worstAfter}`);
  assert.equal(r.player.line()?.text, "Playing the mix");
});
