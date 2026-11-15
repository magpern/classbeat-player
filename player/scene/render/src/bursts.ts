// The white bursts, the song-change dim and the lens flash (scene.md "States", "The flash budget"). A burst is light
// only and never steers: it carries no direction. Two kinds, never within 10 s of each other: the drop's, and the
// light-only burst on an interval change inside a song with no marked moments. Where the model's link gate allows no
// moments (off the list, paused, held) there is no burst of either kind, and the still rig has none. A burst or a dim
// the scheduler has no room for is left out (the rig's `RunBudget`: a drop on an interval change at the Beat level, beside its ramp), a drop's burst goes up in its fixed frame (the interval change's when one is under 1 s away), and a skipped burst does not start the 10 s
// spacing. The lens flash marks an interval change and is the burst's, never both. Pure: time comes in as the frame time.

import type { BeatLevel, LinkInput, SceneClass } from "../../model/src/index.ts";
import { BURST_GAP_MS, gatedBurst, intervalIndexAt, lensShape, momentsAllowed, rigFrozen } from "../../model/src/index.ts";
import { BURST_MS, DIM_EDGE_MS, RunBudget, dropFrame } from "./budget-calc.ts";
import type { Where } from "./budget-calc.ts";
import { burstEnvelope } from "./light-calc.ts";
import { nth } from "./lookup.ts";

export interface BurstInput {
  readonly cls: SceneClass;
  readonly classMs: number;
  readonly songIndex: number;
  readonly songPosMs: number;
  readonly link: LinkInput;
  readonly level: BeatLevel;
  readonly dtMs: number;
  readonly decayMs: number;
  /** The still rig (reduced motion) or before the start: no burst, no dim, no flash. */
  readonly still: boolean;
}
export interface BurstOutput {
  /** 0 to 1: the burst's share of its peak. */
  readonly burst: number;
  /** 0 to 1: how far the rig is dimmed after a song change (down in 120 ms, held, up in 120 ms on the first beat). */
  readonly dim: number;
  /** 0 to 1: the lens flash at an interval change, 160 ms. */
  readonly lens: number;
}

/** A seek moves the song position by more than this in one frame; a drop is not "passed" by a seek. */
const CONTINUOUS_MS = 1000;
const DEFAULT_BEAT_MS = 500;
const FRAME_MS = 1000 / 60;
/** A burst is decided this long before its frame, so the hold's 250 ms lead is there. */
const AHEAD_MS = 1500;

/** The dim's depth `ms` after the song change: down over 120 ms, held to the first beat, up over 120 ms. */
export function dimDepth(ms: number | null, beatMs: number): number {
  if (ms === null || ms < 0 || ms >= beatMs + DIM_EDGE_MS) return 0;
  return ms < DIM_EDGE_MS ? ms / DIM_EDGE_MS : ms < beatMs ? 1 : 1 - (ms - beatMs) / DIM_EDGE_MS;
}

export class BurstTracker {
  /** Every run the rig makes goes through it (the interval change's energy ramp too), and it holds the beat-like light still around them. */
  readonly budget: RunBudget;
  private song = -1;
  private interval = -1;
  private pos = 0;
  private clock = 0;
  private sinceBurst: number | null = null;
  private dimMs: number | null = null;
  private dimBeatMs = DEFAULT_BEAT_MS;
  private lensMs: number | null = null;

  constructor(hold?: { readonly before: number; readonly after: number }, budgetOff = false) {
    this.budget = new RunBudget(hold, budgetOff);
  }

  update(a: BurstInput): BurstOutput {
    const song = nth(a.cls.songs, a.songIndex);
    const interval = intervalIndexAt(a.cls, a.classMs);
    const first = this.song === -1;
    const songChanged = !first && a.songIndex !== this.song;
    const intervalChanged = !first && interval !== this.interval;
    if (this.sinceBurst !== null) this.sinceBurst += a.dtMs;
    if (this.dimMs !== null) this.dimMs += a.dtMs;
    if (this.lensMs !== null) this.lensMs += a.dtMs;
    const where: Where = { cls: a.cls, classMs: a.classMs, songIndex: a.songIndex, songPosMs: a.songPosMs, level: a.level };

    const spaced = this.sinceBurst === null || this.sinceBurst >= BURST_GAP_MS;
    const continuous = !first && !songChanged && Math.abs(a.songPosMs - this.pos) < CONTINUOUS_MS;
    const drops = (song?.moments ?? []).filter((m) => m.kind === "drop");
    const canBurst = !a.still && momentsAllowed(a.link) && song?.bpm !== undefined && song.bpm > 0;
    // Decided ahead, from the song position, so the hold before the burst starts 250 ms ahead of it; the answer is kept.
    const decay = (frame: number) => [{ fromMs: frame + FRAME_MS, toMs: frame + BURST_MS }];
    const nextChange = nth(a.cls.intervals, interval + 1)?.startMs;
    // A drop's burst goes up in its fixed frame (P1): the drop's own, or the nearest interval change's when that is under 1 s away.
    const frames = drops.map((m) => ({ m, at: dropFrame(where, m.at_ms + a.classMs - a.songPosMs) }));
    if (canBurst) for (const { m, at } of frames) if (at > a.classMs && at - a.classMs <= AHEAD_MS && (this.sinceBurst === null || this.sinceBurst + at - a.classMs >= BURST_GAP_MS)) this.budget.admit(`drop@${m.at_ms}`, "dropBurst", decay(at), where);
    if (!a.still && momentsAllowed(a.link) && drops.length === 0 && (song?.moments ?? []).length === 0 && nextChange !== undefined && nextChange - a.classMs <= AHEAD_MS && nextChange > a.classMs &&
      (this.sinceBurst === null || this.sinceBurst + nextChange - a.classMs >= BURST_GAP_MS)) this.budget.admit(`light@${nextChange}`, "lightBurst", decay(nextChange), where);
    const passed = continuous && canBurst ? frames.find(({ at }) => this.clock < at && at <= a.classMs)?.m : undefined;
    const clockContinuous = !first && Math.abs(a.classMs - this.clock) < CONTINUOUS_MS;
    const light = clockContinuous ? gatedBurst(a.link, (song?.moments ?? []).length > 0, intervalChanged, this.sinceBurst) : null;
    let burstNow = false;
    if (!a.still && spaced && (passed !== undefined || light !== null)) {
      const id = passed !== undefined ? `drop@${passed.at_ms}` : `light@${nth(a.cls.intervals, interval)?.startMs ?? 0}`;
      if (this.budget.admit(id, passed !== undefined ? "dropBurst" : "lightBurst", decay(a.classMs), where)) { this.sinceBurst = 0; burstNow = true; }
    }

    if (songChanged && !a.still) {
      this.dimBeatMs = song?.bpm && song.bpm > 0 ? 60_000 / song.bpm : DEFAULT_BEAT_MS;
      const down = { fromMs: a.classMs, toMs: a.classMs + DIM_EDGE_MS };
      const up = { fromMs: a.classMs + this.dimBeatMs, toMs: a.classMs + this.dimBeatMs + DIM_EDGE_MS };
      this.dimMs = this.budget.admit(`dim@${a.songIndex}`, "dim", [down, up], where) ? 0 : null;
    }
    const lensAllowed = !a.still && !rigFrozen(a.link) && Math.abs(a.classMs - this.clock) < CONTINUOUS_MS && !burstNow;
    if (intervalChanged && lensAllowed) this.lensMs = 0;

    [this.song, this.interval, this.pos, this.clock] = [a.songIndex, interval, a.songPosMs, a.classMs];
    return { burst: burstEnvelope(this.sinceBurst, a.decayMs), dim: dimDepth(this.dimMs, this.dimBeatMs), lens: lensShape(this.lensMs ?? -1) };
  }
}
