// The white bursts and the song-change dim (scene.md "States"). A burst is light only and never
// steers: it carries no direction. Two kinds, never within 10 s of each other: the drop's, and the
// light-only burst on an interval change inside a song with no marked moments. Where the model's
// link gate allows no moments (off the list, paused, held) there is no burst of either kind, and
// the still rig has none. Pure: time comes in as the frame time.

import type { LinkInput, SceneClass } from "../../model/src/index.ts";
import { BURST_GAP_MS, gatedBurst, intervalIndexAt, momentsAllowed } from "../../model/src/index.ts";
import { burstEnvelope } from "./light-calc.ts";

export interface BurstInput {
  readonly cls: SceneClass;
  readonly classMs: number;
  readonly songIndex: number;
  readonly songPosMs: number;
  readonly link: LinkInput;
  readonly dtMs: number;
  readonly decayMs: number;
  /** The still rig (reduced motion): no burst, no dim. */
  readonly still: boolean;
}
export interface BurstOutput {
  /** 0 to 1: the burst's share of its peak. */
  readonly burst: number;
  /** The rig is dimmed to a quarter for one beat after a song change. */
  readonly dim: boolean;
}

/** A seek moves the song position by more than this in one frame; a drop is not "passed" by a seek. */
const CONTINUOUS_MS = 1000;
const DEFAULT_BEAT_MS = 500;

export class BurstTracker {
  private song = -1;
  private interval = -1;
  private pos = 0;
  private sinceBurst: number | null = null;
  private dimLeft = 0;

  update(a: BurstInput): BurstOutput {
    const song = a.cls.songs[a.songIndex];
    const interval = intervalIndexAt(a.cls, a.classMs);
    const first = this.song === -1;
    const songChanged = !first && a.songIndex !== this.song;
    const intervalChanged = !first && interval !== this.interval;
    if (this.sinceBurst !== null) this.sinceBurst += a.dtMs;
    this.dimLeft = Math.max(0, this.dimLeft - a.dtMs);
    if (songChanged && !a.still) this.dimLeft = song?.bpm && song.bpm > 0 ? 60_000 / song.bpm : DEFAULT_BEAT_MS;

    const spaced = this.sinceBurst === null || this.sinceBurst >= BURST_GAP_MS;
    const continuous = !first && !songChanged && Math.abs(a.songPosMs - this.pos) < CONTINUOUS_MS;
    const dropPassed = continuous && momentsAllowed(a.link) && song?.bpm !== undefined && song.bpm > 0 &&
      (song.moments ?? []).some((m) => m.kind === "drop" && this.pos < m.at_ms && m.at_ms <= a.songPosMs);
    const light = gatedBurst(a.link, (song?.moments ?? []).length > 0, intervalChanged, this.sinceBurst);
    if (!a.still && spaced && (dropPassed || light !== null)) this.sinceBurst = 0;

    [this.song, this.interval, this.pos] = [a.songIndex, interval, a.songPosMs];
    return { burst: burstEnvelope(this.sinceBurst, a.decayMs), dim: this.dimLeft > 0 };
  }
}
