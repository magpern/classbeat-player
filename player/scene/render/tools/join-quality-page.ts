// The page of the join's quality run (join-quality-shots.ts): the real `mountScene` (join/mount.ts, so the real WebGL renderer behind it)
// on a page with a hand-driven clock. `step` plays frames at a slow, fixed frame time, so the join's own frame-rate monitor steps the
// level down; the page reports the canvas's drawing size, which is what the renderer's level changes (render scale, scene.md "Quality levels").
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { mountScene } from "../join/mount.ts";
import type { JoinFrame } from "../join/room-feed-calc.ts";

const doc = {
  class: { title: "Fake ride", sport: "cycling", length_ms: 120_000 },
  music: { source: "spotify", design_crossfade_ms: 0, song_timing: "measured" },
  zone_scale: [{ zone: 1, name: "Easy", rpe: [1, 2] }, { zone: 2, name: "Steady", ftp_pct: [56, 75] }],
  intervals: [{ start_ms: 0, length_ms: 60_000, zone: 1, cue: "Spin.", cadence: "beat" }, { start_ms: 60_000, length_ms: 60_000, zone: 2, cue: "Hold." }],
  songs: [{ title: "A", artist: "B", length_ms: 120_000, start_ms: 0, end_ms: 120_000, bpm: 120, beat_anchors: { quality: "measured", anchors: [{ at_ms: 0, bpm: 120 }] } }],
} as unknown as Class;
const frame: JoinFrame = {
  doc, playlistNotLoaded: false, mix: null, view: { status: "running", classMs: 10_000, songIndex: null },
  link: { mode: "following", state: "Locked", held: false, songIndex: null, announcement: null, available: true },
};

let fake = 1000;
const waiting = new Map<number, FrameRequestCallback>();
let ids = 0;
performance.now = () => fake;
window.requestAnimationFrame = (cb) => { waiting.set(++ids, cb); return ids; };
window.cancelAnimationFrame = (id) => { waiting.delete(id); };

const rows: { level: string; fps: number }[] = [];
const join = mountScene({ reducedMotion: false, visible: () => true, onSecond: (r) => rows.push({ level: r.level, fps: r.fps }) });
join.push(frame);

const canvas = document.getElementById("scene") as HTMLCanvasElement;
(window as unknown as { __join: unknown }).__join = {
  /** One frame at `ms` after the last; the join gets the shell's frame again first, as the shell sends one every 100 ms. */
  step(ms: number): void {
    fake += ms;
    join.push(frame);
    const run = [...waiting.values()];
    waiting.clear();
    for (const cb of run) cb(fake);
  },
  state: () => ({ width: canvas.width, height: canvas.height, mode: document.documentElement.dataset.scene ?? "", why: join.why, level: rows.at(-1)?.level ?? "" }),
};
