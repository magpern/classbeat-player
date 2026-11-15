// The white bursts, the lens flash and the song-change dim (scene.md "States"). A burst is light only
// and never steers: it carries no direction. Two kinds, never within 10 s of each other: the drop's, and
// the light-only burst on an interval change inside a song with no marked moments. Where the model's
// link gate allows no moments (off the list, paused, held) there is no burst of either kind, and the
// still rig has none. The lens flash (white, `--m-flash`) is the third orchestrated moment: every lens
// once at an interval change, unless a burst falls on the same moment, which then replaces it (one
// event, not two, S6). Pure: time comes in as the frame time.

import type { LinkInput, SceneClass } from "../../model/src/index.ts";
import { BURST_GAP_MS, gatedBurst, intervalIndexAt, momentsAllowed } from "../../model/src/index.ts";
import { burstEnvelope } from "./light-calc.ts";
import { nth } from "./lookup.ts";

export interface BurstInput {
  readonly cls: SceneClass;
  readonly classMs: number;
  readonly songIndex: number;
  readonly songPosMs: number;
  readonly link: LinkInput;
  readonly dtMs: number;
  readonly decayMs: number;
  /** `--m-flash`: the lens flash's length; 0 means none. */
  readonly flashMs: number;
  /** The still rig (reduced motion): no burst, no flash, no dim. */
  readonly still: boolean;
}
export interface BurstOutput {
  /** 0 to 1: the burst's share of its peak. */
  readonly burst: number;
  /** 0 to 1: the lens flash's share of its peak, 1 at the interval change, linear to 0 over `flashMs`. */
  readonly flash: number;
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
  private classMs = 0;
  private sinceBurst: number | null = null;
  private sinceFlash: number | null = null;
  private dimLeft = 0;

  update(a: BurstInput): BurstOutput {
    const song = nth(a.cls.songs, a.songIndex);
    const interval = intervalIndexAt(a.cls, a.classMs);
    const first = this.song === -1;
    const songChanged = !first && a.songIndex !== this.song;
    const intervalChanged = !first && interval !== this.interval;
    if (this.sinceBurst !== null) this.sinceBurst += a.dtMs;
    if (this.sinceFlash !== null) this.sinceFlash += a.dtMs;
    this.dimLeft = Math.max(0, this.dimLeft - a.dtMs);
    if (songChanged && !a.still) this.dimLeft = song?.bpm && song.bpm > 0 ? 60_000 / song.bpm : DEFAULT_BEAT_MS;

    const spaced = this.sinceBurst === null || this.sinceBurst >= BURST_GAP_MS;
    const continuous = !first && !songChanged && Math.abs(a.songPosMs - this.pos) < CONTINUOUS_MS;
    const dropPassed = continuous && momentsAllowed(a.link) && song?.bpm !== undefined && song.bpm > 0 &&
      (song.moments ?? []).some((m) => m.kind === "drop" && this.pos < m.at_ms && m.at_ms <= a.songPosMs);
    const light = gatedBurst(a.link, (song?.moments ?? []).length > 0, intervalChanged, this.sinceBurst);
    if (!a.still && spaced && (dropPassed || light !== null)) this.sinceBurst = 0;

    // The lens flash: a change to the next interval in real time, and no burst on the same moment (one begun within
    // its span, or a drop due within it, replaces it: one white event, never two).
    const span = Math.max(a.flashMs, a.decayMs);
    const dropDue = (song?.moments ?? []).some((m) => m.kind === "drop" && a.songPosMs < m.at_ms && m.at_ms <= a.songPosMs + span);
    const inTime = !first && Math.abs(a.classMs - this.classMs) < CONTINUOUS_MS && interval === this.interval + 1;
    const burstNear = this.sinceBurst !== null && this.sinceBurst < span;
    if (!a.still && a.flashMs > 0 && inTime && momentsAllowed(a.link) && !burstNear && !dropDue) this.sinceFlash = 0;

    [this.song, this.interval, this.pos, this.classMs] = [a.songIndex, interval, a.songPosMs, a.classMs];
    return { burst: burstEnvelope(this.sinceBurst, a.decayMs), flash: burstEnvelope(this.sinceFlash, a.flashMs), dim: this.dimLeft > 0 };
  }
}
