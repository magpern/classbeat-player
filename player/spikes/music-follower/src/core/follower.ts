// Prototype of the class clock and link states of plan section 4. Pure: no I/O.
import type { Plan } from "./class_plan.js";
import { matchCandidates } from "./match.js";
import type { Decision, LinkState, Reading } from "./types.js";

export interface FollowerConfig {
  /** A reading older than this (by its own poll time) is never used as current. */
  staleMs: number;
  /** Backward corrections smaller than this are smoothed out. */
  backwardToleranceMs: number;
  /** A same-song jump larger than this is reported as a seek. */
  seekMs: number;
  /** A re-lock correction larger than this is announced. */
  announceMs: number;
  /** Two occurrences closer than this (in distance to the clock) are Ambiguous. */
  ambiguityMarginMs: number;
}

export const DEFAULT_CONFIG: FollowerConfig = {
  staleMs: 2500,
  backwardToleranceMs: 500,
  seekMs: 1500,
  announceMs: 5000,
  ambiguityMarginMs: 10_000,
};

export class ClassFollower {
  private clockMs = 0;
  private started = false;
  private running = false;
  private state: LinkState = "Manual";
  private songIndex: number | null = null;
  private lastNow: number | null = null;
  private last: Reading | null = null;
  private manual = false;
  private picked: number | null = null;
  private force = false;
  private undoClockMs: number | null = null;

  constructor(
    private readonly plan: Plan,
    private readonly cfg: FollowerConfig = DEFAULT_CONFIG,
  ) {}

  /** Feed one poll (`null` = no reading). Call at the poll rate with a monotonic time. */
  step(nowMs: number, reading: Reading | null): Decision {
    const dt = this.lastNow === null ? 0 : Math.max(0, nowMs - this.lastNow);
    this.lastNow = nowMs;
    if (reading) this.last = reading;
    if (this.manual) {
      if (this.running) this.clockMs += dt;
      return this.decide(nowMs, { event: null });
    }
    if (!this.last || nowMs - this.last.polledAtMs > this.cfg.staleMs) return this.coast(nowMs, dt);
    return this.follow(nowMs, dt, this.last);
  }

  /** The instructor undoes a resync: back to the manual clock at the earlier place. */
  undo(nowMs: number): Decision {
    if (this.undoClockMs === null) return this.decide(nowMs, { event: null });
    this.manual = true;
    this.running = true;
    this.clockMs = this.undoClockMs;
    this.undoClockMs = null;
    this.state = "Manual";
    this.lastNow = nowMs;
    return this.decide(nowMs, { event: "undo" });
  }

  /** Leave the manual clock and follow the music again. */
  relink(): void {
    this.manual = false;
  }

  /** The instructor picks which occurrence of a repeated recording is playing. */
  pickOccurrence(index: number): void {
    this.picked = index;
    this.songIndex = index;
    this.force = true;
  }

  private coast(nowMs: number, dt: number): Decision {
    if (!this.started) return this.decide(nowMs, { event: null });
    const event = this.state !== "Coasting" ? "coasting" : null;
    this.state = "Coasting";
    this.running = true;
    this.clockMs += dt;
    return this.decide(nowMs, { event });
  }

  private offList(nowMs: number, dt: number): Decision {
    const event = this.state !== "Off the list" ? "off_list" : null;
    this.state = "Off the list";
    this.songIndex = null;
    if (this.started) {
      this.running = true;
      this.clockMs += dt;
    }
    return this.decide(nowMs, { event });
  }

  private follow(nowMs: number, dt: number, r: Reading): Decision {
    const pos = r.state === "playing" ? r.positionMs + Math.max(0, nowMs - r.readAtMs) : r.positionMs;
    const cands = matchCandidates(this.plan, r);
    if (cands.length === 0) return this.offList(nowMs, dt);

    const prevState = this.state;
    const prevIndex = this.songIndex;
    const prevClock = this.clockMs;
    const expected = this.started ? prevClock + (this.running ? dt : 0) : null;
    const { index, ambiguous } = this.choose(cands, pos, expected);
    const song = this.plan.songs[index]!;
    const raw = song.startMs + pos;
    const target = Math.max(0, Math.min(raw, song.endMs));

    let clock = target;
    if (this.started && !this.force && target < prevClock && prevClock - target <= this.cfg.backwardToleranceMs) {
      clock = prevClock; // smoothed: the clock never moves backwards by itself
    }
    this.force = false;
    const delta = expected === null ? null : clock - expected;

    this.clockMs = clock;
    this.started = true;
    this.songIndex = index;
    this.running = r.state === "playing";
    this.state = ambiguous ? "Ambiguous" : r.state === "playing" ? "Locked" : "Paused";

    let event: string | null = null;
    let announce: string | null = null;
    if (expected === null) event = "locked";
    else if (prevState === "Coasting" || prevState === "Off the list") {
      event = "relock";
      if (Math.abs(delta!) > this.cfg.announceMs) {
        announce = `resynced, ${Math.round(Math.abs(delta!) / 1000)} s ${delta! < 0 ? "back" : "forward"}`;
        this.undoClockMs = expected;
      }
    } else if (prevIndex !== index) event = "song_change";
    else if (Math.abs(delta!) > this.cfg.seekMs) event = "seek";
    else if (prevState === "Paused" && this.state === "Locked") event = "resume";
    else if (prevState === "Locked" && this.state === "Paused") event = "pause";
    else if (this.state === "Ambiguous" && prevState !== "Ambiguous") event = "ambiguous";

    return this.decide(nowMs, { event, deltaMs: delta, held: raw > song.endMs, announce, candidates: cands });
  }

  private choose(cands: number[], pos: number, expected: number | null): { index: number; ambiguous: boolean } {
    if (this.picked !== null && cands.includes(this.picked)) return { index: this.picked, ambiguous: false };
    this.picked = null;
    if (cands.length === 1) return { index: cands[0]!, ambiguous: false };
    if (expected === null) return { index: cands[0]!, ambiguous: true }; // cold start: report, do not guess silently
    const ranked = cands
      .map((i) => {
        const s = this.plan.songs[i]!;
        return { i, d: Math.abs(Math.min(s.startMs + pos, s.endMs) - expected) };
      })
      .sort((a, b) => a.d - b.d);
    return { index: ranked[0]!.i, ambiguous: ranked[1]!.d - ranked[0]!.d < this.cfg.ambiguityMarginMs };
  }

  private decide(nowMs: number, p: Partial<Decision>): Decision {
    return {
      nowMs,
      state: this.state,
      classTimeMs: this.clockMs,
      running: this.running,
      songIndex: this.songIndex,
      candidates: [],
      event: null,
      deltaMs: null,
      held: false,
      announce: null,
      readingAgeMs: this.last ? nowMs - this.last.polledAtMs : null,
      ...p,
    };
  }
}
