// The join (join/): reduced motion shows the plain screen and never builds the scene (S11); a scene that is killed, by a
// renderer error, a lost context, no WebGL or a stalled frame, shows the plain screen within 2 s with the clock still the
// frame's own (S10). Every failure is a fake: the ports are driven by hand, no browser, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { CARRY_MAX_MS, carriedMs, feedOf } from "../join/room-feed-calc.ts";
import type { TextLink } from "../src/text-types.ts";
import type { JoinFrame } from "../join/room-feed-calc.ts";
import { STALL_MS, WATCH_EVERY_MS, startJoin } from "../join/scene-join.ts";
import type { JoinPorts, SceneHandle } from "../join/scene-join.ts";

const doc = {
  class: { title: "Fake ride", sport: "cycling", length_ms: 120_000 },
  music: { source: "spotify", design_crossfade_ms: 0, song_timing: "measured" },
  zone_scale: [{ zone: 1, name: "Easy", rpe: [1, 2] }, { zone: 2, name: "Steady", ftp_pct: [56, 75] }],
  intervals: [{ start_ms: 0, length_ms: 60_000, zone: 1, cue: "Spin.", cadence: "beat" }, { start_ms: 60_000, length_ms: 60_000, zone: 2, cue: "Hold.", pattern: { kind: "alternate", positions: ["seated", "standing"], beats: [8, 8] } }],
  songs: [{ title: "A", artist: "B", length_ms: 120_000, start_ms: 0, end_ms: 120_000, bpm: 120, beat_anchors: { quality: "measured", anchors: [{ at_ms: 0, bpm: 120 }] } }],
} as unknown as Class;
const frame = (over: Partial<JoinFrame["view"] & object> = {}, link: Partial<NonNullable<JoinFrame["link"]>> = {}): JoinFrame => ({
  doc, playlistNotLoaded: false, mix: null, view: { status: "running", classMs: 10_000, songIndex: null, ...over },
  link: { mode: "following", state: "Locked", held: false, songIndex: null, announcement: null, available: true, ...link },
});

/** Ports driven by hand: a clock, the animation frames and the timers. */
function fake(opts: { create?: (onLost: () => void) => SceneHandle; visible?: boolean } = {}) {
  let t = 0;
  let frames: ((n: number) => void)[] = [];
  let timers: { at: number; run: () => void }[] = [];
  const shown: string[] = [];
  const drawn: { classMs: number; reduced: boolean }[] = [];
  let lost: () => void = () => undefined;
  let created = 0;
  const handle: SceneHandle = { frame: ({ feed }) => { drawn.push({ classMs: feed.classMs, reduced: feed.reducedMotion }); }, dispose: () => undefined };
  const ports: JoinPorts = {
    now: () => t,
    schedule: (cb) => { frames.push(cb); return () => { frames = frames.filter((f) => f !== cb); }; },
    later: (run, ms) => { const e = { at: t + ms, run }; timers.push(e); return () => { timers = timers.filter((x) => x !== e); }; },
    create: (onLost) => { created++; lost = onLost; return (opts.create ?? (() => handle))(onLost); },
    show: (m) => { shown.push(m); },
    visible: () => opts.visible !== false,
  };
  /** Advances the clock by `ms`, running the timers that fall due, and `animate` says whether the browser still gives frames. */
  const advance = (ms: number, animate = true): void => {
    const end = t + ms;
    while (t < end) {
      t = Math.min(end, t + 16);
      if (animate) { const run = frames; frames = []; run.forEach((f) => f(t)); }
      const due = timers.filter((x) => x.at <= t);
      timers = timers.filter((x) => x.at > t);
      due.forEach((x) => x.run());
    }
  };
  return { ports, advance, shown, drawn, lost: () => lost(), created: () => created, now: () => t };
}

test("S11: reduced motion shows the plain screen, and the scene is never built", () => {
  const f = fake();
  const join = startJoin(f.ports, { reducedMotion: true });
  join.push(frame());
  f.advance(1000);
  assert.equal(join.mode, "plain");
  assert.equal(join.why, "reduced motion");
  assert.equal(f.created(), 0);
  assert.deepEqual(f.drawn, []);
});

test("the still rig (presenter preview, CI's reduced shots) shows the scene with reduced motion on in the feed", () => {
  const f = fake();
  const join = startJoin(f.ports, { reducedMotion: true, stillRig: true });
  join.push(frame());
  f.advance(100);
  assert.equal(join.mode, "scene");
  assert.ok(f.drawn.length > 0 && f.drawn.every((d) => d.reduced));
});

test("with motion allowed the scene shows once there is a class, and only then", () => {
  const f = fake();
  const join = startJoin(f.ports, { reducedMotion: false });
  f.advance(100);
  assert.equal(join.mode, "plain");
  join.push(frame());
  f.advance(100);
  assert.equal(join.mode, "scene");
  assert.ok(f.drawn.every((d) => !d.reduced));
});

test("S10: no WebGL shows the plain screen at once", () => {
  const f = fake({ create: () => { throw new Error("no WebGL"); } });
  const join = startJoin(f.ports, { reducedMotion: false });
  join.push(frame());
  f.advance(100);
  assert.equal(join.mode, "plain");
  assert.equal(join.why, "no WebGL");
});

test("S10: a renderer error on a frame shows the plain screen on that frame, and the scene does not come back", () => {
  let n = 0;
  const f = fake({ create: () => ({ frame: () => { if (++n === 3) throw new Error("boom"); }, dispose: () => undefined }) });
  const join = startJoin(f.ports, { reducedMotion: false });
  join.push(frame());
  f.advance(32);
  assert.equal(join.mode, "scene");
  f.advance(100);
  assert.equal(join.mode, "plain");
  assert.equal(join.why, "renderer error");
  join.push(frame());
  f.advance(500);
  assert.equal(join.mode, "plain");
  assert.equal(n, 3);
});

test("S10: a lost WebGL context shows the plain screen at once", () => {
  const f = fake();
  const join = startJoin(f.ports, { reducedMotion: false });
  join.push(frame());
  f.advance(100);
  f.lost();
  assert.equal(join.mode, "plain");
  assert.equal(join.why, "context lost");
});

test("S10: a scene that stops drawing is given up within 2 s", () => {
  const f = fake();
  const join = startJoin(f.ports, { reducedMotion: false });
  join.push(frame());
  f.advance(500);
  const stoppedAt = f.now();
  f.advance(2000, false);
  assert.equal(join.mode, "plain");
  assert.equal(join.why, "no frames");
  assert.ok(STALL_MS + WATCH_EVERY_MS < 2000);
  // Find when it switched: the shown log ends with "plain", and the time since the last frame stayed under the 2 s.
  assert.equal(f.shown.at(-1), "plain");
  assert.ok(stoppedAt > 0);
});

test("S10: the stall is given up at most STALL_MS + WATCH_EVERY_MS after the last frame", () => {
  const f = fake();
  const join = startJoin(f.ports, { reducedMotion: false });
  join.push(frame());
  f.advance(200);
  let waited = 0;
  while (join.mode === "scene" && waited < 5000) { f.advance(16, false); waited += 16; }
  assert.ok(waited <= 2000, `took ${waited} ms`);
});

test("a hidden window gets no frames and is not a failure", () => {
  const f = fake({ visible: false });
  const join = startJoin(f.ports, { reducedMotion: false });
  join.push(frame());
  f.advance(200);
  f.advance(5000, false);
  assert.equal(join.mode, "scene");
});

test("S10: the clock stays the frame's own: the plain screen keeps the clock the shell sent, and the scene's feed never runs ahead of it by more than the carry", () => {
  const f = fake();
  const join = startJoin(f.ports, { reducedMotion: false });
  join.push(frame({ classMs: 10_000 }));
  f.advance(250);
  const before = f.drawn.at(-1)!.classMs;
  assert.ok(before >= 10_000 && before <= 10_000 + CARRY_MAX_MS);
  join.push(frame({ classMs: 10_100 }));
  f.lost();
  assert.equal(join.mode, "plain");
  const last = f.drawn.length;
  f.advance(500);
  assert.equal(f.drawn.length, last, "nothing is drawn after the kill");
});

test("the feed: the clock is carried only while it runs, is capped, and holds a paused class", () => {
  assert.equal(carriedMs(frame({ classMs: 5000 }), 100), 5100);
  assert.equal(carriedMs(frame({ classMs: 5000 }), 5000), 5000 + CARRY_MAX_MS);
  assert.equal(carriedMs(frame({ classMs: 5000, status: "paused" }), 100), 5000);
  assert.equal(carriedMs(frame({ classMs: 5000 }, { state: "Paused" }), 100), 5000);
  assert.equal(carriedMs(frame({ classMs: 5000, status: "ready" }), 100), 5000);
});

test("the feed: song, link and stage come from the frame; nothing else does", () => {
  const out = feedOf(frame({ classMs: 0, status: "ready" }, { held: true }), 0, false)!;
  assert.equal(out.feed.stage, "before");
  assert.deepEqual(out.feed.link, { mode: "following", started: false, state: "Locked", held: true });
  assert.equal(out.feed.songPosMs, 0);
  assert.deepEqual(Object.keys(out.feed).sort(), ["classMs", "cls", "link", "playlistNotLoaded", "reducedMotion", "songIndex", "songPosMs", "stage"]);
  assert.deepEqual(feedOf(frame({}, { mode: "manual", state: "Locked" }), 0, false)!.feed.link, { mode: "manual", started: true, state: "Manual", announcement: false, available: true });
  assert.equal(out.text.intervals[1]!.pattern?.startOn, "interval_start");
  assert.deepEqual(out.text.intervals[0]!.cadence, "beat");
  assert.equal(out.text.following, "Following Spotify");
  assert.deepEqual(out.text.zones[1]!.targets, ["56–75% FTP"]);
});

test("the feed: no class, no clock or no songs means the plain screen", () => {
  assert.equal(feedOf({ doc: null, playlistNotLoaded: false, mix: null, view: null, link: null }, 0, false), null);
  assert.equal(feedOf({ ...frame(), doc: { ...doc, songs: [] } as Class }, 0, false), null);
});

test("a healthy, visible scene stays up for far longer than the stall window, drawing every frame", () => {
  const f = fake();
  const join = startJoin(f.ports, { reducedMotion: false });
  join.push(frame());
  f.advance(10 * (STALL_MS + WATCH_EVERY_MS));
  assert.equal(join.mode, "scene");
  assert.equal(join.why, null);
  assert.ok(f.drawn.length > 600);
});

test("a scene given up on stays down for that class and is tried again for the next one, or a fresh run of it", () => {
  const f = fake();
  const join = startJoin(f.ports, { reducedMotion: false });
  join.push(frame());
  f.advance(100);
  f.advance(2000, false);
  assert.equal(join.why, "no frames");
  const made = f.created();
  join.push(frame({ classMs: 20_000 }));
  f.advance(500);
  assert.equal(join.mode, "plain", "the same class: not again");
  assert.equal(f.created(), made);
  const another = { ...doc, class: { ...doc.class, title: "Another ride" } } as Class;
  join.push({ ...frame(), doc: another, view: { status: "running", classMs: 30_000, songIndex: null } });
  f.advance(100);
  assert.equal(f.created(), made + 1);
  assert.equal(join.mode, "scene");
  assert.equal(join.why, null);
  f.lost();
  // The scene was given up on in "Another ride" while it ran. The same class, still running, is not a new chance ...
  join.push({ ...frame(), doc: another, view: { status: "running", classMs: 31_000, songIndex: null } });
  f.advance(100);
  assert.equal(f.created(), made + 1, "the same class, still running");
  // ... but the same class started again (the clock ready at 0) is.
  join.push({ ...frame(), doc: another, view: { status: "ready", classMs: 0, songIndex: null } });
  f.advance(100);
  assert.equal(f.created(), made + 2, "a fresh run of the same class");
  assert.equal(join.mode, "scene");
});

test("reduced motion is never tried again, whatever class comes", () => {
  const f = fake();
  const join = startJoin(f.ports, { reducedMotion: true });
  join.push(frame());
  join.push({ ...frame(), doc: { ...doc, class: { ...doc.class, title: "Another ride" } } as Class });
  f.advance(500);
  assert.equal(f.created(), 0);
});

test("a stopped join stays stopped", () => {
  const f = fake();
  const join = startJoin(f.ports, { reducedMotion: false });
  join.push(frame());
  join.stop();
  join.push({ ...frame(), doc: { ...doc, class: { ...doc.class, title: "Another ride" } } as Class });
  f.advance(500);
  assert.equal(f.created(), 1);
  assert.equal(join.mode, "plain");
});

test("the playlist notice goes from the frame to the feed", () => {
  assert.equal(feedOf({ ...frame(), playlistNotLoaded: true }, 0, false)!.feed.playlistNotLoaded, true);
  assert.equal(feedOf(frame(), 0, false)!.feed.playlistNotLoaded, false);
});

test("the link as the plain screen's words need it: following-before-lock is not the manual clock", () => {
  const link = (over: Partial<NonNullable<JoinFrame["link"]>>) => feedOf(frame({}, over), 0, false)!.feed.link;
  assert.deepEqual(link({ state: "Manual" }), { mode: "following", started: true, state: "Manual", held: false });
  assert.deepEqual(link({ mode: "manual", state: "Locked", announcement: "x", available: true }), { mode: "manual", started: true, state: "Manual", announcement: true, available: true });
  assert.equal(JSON.stringify(link({ mode: "manual", announcement: "private words" })).includes("private"), false, "only whether there is an announcement is read");
  assert.equal((feedOf(frame({ classMs: 0, status: "ready" }), 0, false)!.feed.link as TextLink).started, false);
  assert.deepEqual(feedOf({ ...frame(), link: null }, 0, false)!.feed.link, { mode: "manual", started: true, state: "Manual" });
});

test("the playlist notice is not carried once the class has ended", () => {
  assert.equal(feedOf({ ...frame({ status: "ended", classMs: 120_000 }), playlistNotLoaded: true }, 0, false)!.feed.playlistNotLoaded, false);
});

test("the mix class's link line goes to the scene's text in its fixed words only, and not once the class has ended", () => {
  const mix = (text: string, shape: "dot" | "circle" | "square" | "news") => ({ ...frame(), mix: { text, shape } });
  const link = (f: JoinFrame) => (feedOf(f, 0, false)!.feed.link as TextLink).mix;
  assert.deepEqual(link(mix("Playing the mix", "dot")), { text: "Playing the mix", shape: "dot" });
  assert.deepEqual(link(mix("Downloading the mix 63%", "circle")), { text: "Downloading the mix 63%", shape: "circle" });
  assert.equal(link(mix("Anything else a class could say", "dot")), undefined, "words that are not a fixed pair are dropped");
  assert.equal(link(mix("Playing the mix", "square")), undefined, "a fixed word with the wrong shape is dropped");
  assert.equal(link(frame()), undefined);
  assert.equal(link({ ...mix("Playing the mix", "dot"), view: { status: "ended", classMs: 120_000, songIndex: null } }), undefined);
});
