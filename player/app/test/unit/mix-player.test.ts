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
    doc: { music: m },
    view: status === null ? null : { status, classMs },
  }) as unknown as Snapshot;

function rig(
  o: {
    view?: MixView;
    outcome?: Promise<CacheOutcome>;
    complete?: boolean;
    room?: number | null;
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
    download: (a, m, keep) => {
      log.push(`download ${a === A} ${m} ${JSON.stringify(keep)}`);
      return outcome;
    },
    open: () => reader(complete),
    played: (_a, m) => void log.push(`played ${m}`),
    evict: (_a, opts) => {
      log.push(`evict ${JSON.stringify(opts.keep)}`);
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
  assert.deepEqual(r.log, ["evict []"]);
});

test("opening a mix class starts its download, keeping that mix; the line shows the progress", async () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  assert.deepEqual(r.log, ['evict ["mix_1"]', 'download true mix_1 ["mix_1"]']);
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
  });
  assert.deepEqual(r.aligned, [2_000]);
});

test("the reports steer the running clock past the drift only, and a late report is dropped", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  const seq = r.cues[0]!.seq;
  r.advance(1_000);
  r.player.report({ seq, positionMs: 1_100, playing: true, failed: false });
  assert.deepEqual(r.aligned, [], "within the drift");
  r.player.report({ seq, positionMs: 1_600, playing: true, failed: false });
  assert.deepEqual(r.aligned, [1_600]);
  r.player.report({
    seq: seq - 1,
    positionMs: 9_000,
    playing: true,
    failed: false,
  });
  r.player.report({
    seq: seq + 1,
    positionMs: 9_000,
    playing: true,
    failed: false,
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
  });
  assert.deepEqual(r.player.line(), { text: "Mix not checked", shape: "news" });
});

test("sign-out mid-class ends the play: the next snapshot falls back", () => {
  const r = rig();
  r.player.snapshot(snap(1, "ready"));
  r.player.snapshot(snap(1, "running", 0));
  r.plays.endAccount(A);
  r.player.snapshot(snap(1, "running", 100));
  assert.deepEqual(r.player.line(), {
    text: "Mix still downloading",
    shape: "news",
  });
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
  assert.equal(r.log.at(-1), 'evict ["mix_1"]');
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
  assert.ok(r.log.includes('evict ["mix_2"]'));
  assert.ok(r.log.includes('download true mix_2 ["mix_2"]'));
});
