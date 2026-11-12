import type { PlayState, Reading } from "../core/types.js";
import type { Reader } from "./reader.js";

export interface TrackRef {
  trackId: string | null;
  title: string;
  artist: string;
  durationMs?: number;
}

/** From time `at` on: `track` (undefined = unchanged, null = nothing playing), position and state. */
export interface FakeEvent {
  at: number;
  track?: TrackRef | null;
  positionMs?: number;
  state?: PlayState;
}

export interface FakeScript {
  events: FakeEvent[];
  /** Ranges [from, to) in which the reader returns null (app closed, interface silent). */
  lost?: Array<[number, number]>;
  /** Ranges [from, to) in which the reader keeps returning the reading from `from` (frozen). */
  frozen?: Array<[number, number]>;
}

/** A reader driven by a script of events, for tests. Time is whatever the test says it is. */
export class FakeReader implements Reader {
  readonly source = "fake";
  private t = 0;

  constructor(private readonly script: FakeScript) {}

  setTime(t: number): void {
    this.t = t;
  }

  async readNow(): Promise<Reading | null> {
    return this.readAt(this.t);
  }

  readAt(t: number): Reading | null {
    if (this.script.lost?.some(([a, b]) => t >= a && t < b)) return null;
    const frozen = this.script.frozen?.find(([a, b]) => t >= a && t < b);
    return this.compute(frozen ? frozen[0] : t);
  }

  private compute(t: number): Reading | null {
    let track: TrackRef | null = null;
    let pos = 0;
    let state: PlayState = "stopped";
    let since = 0;
    for (const e of [...this.script.events].sort((a, b) => a.at - b.at)) {
      if (e.at > t) break;
      if (state === "playing") pos += e.at - since;
      since = e.at;
      if (e.track !== undefined) {
        if (e.track !== track) pos = 0;
        track = e.track;
      }
      if (e.positionMs !== undefined) pos = e.positionMs;
      if (e.state !== undefined) state = e.state;
    }
    if (!track) return null;
    if (state === "playing") pos += t - since;
    return {
      trackId: track.trackId,
      title: track.title,
      artist: track.artist,
      durationMs: track.durationMs ?? null,
      positionMs: pos,
      state,
      readAtMs: t,
      polledAtMs: t,
      source: this.source,
    };
  }
}
