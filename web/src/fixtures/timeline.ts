// A class played on a clock, as the player's shell would send it to the room screen: a recorded snapshot
// (a fixture) is the starting point; what happens next is a list of events (pause, resume, start, a seek or
// jump, a link state). The checks of the flash budget (S6) play it through a clock they step by frames, with a
// snapshot at every frame (the harshest cadence), on the real screen and on the pure gate. Pure.
import type { Class, ClockStatus, LinkStateName, PatternInput, RoomInput } from "../room/input.ts";
import { clockAt, linkAt } from "./build.ts";
import { FIXTURES } from "./index.ts";

export type TimelineEvent =
  | { readonly atMs: number; readonly do: "pause" | "resume" | "start" }
  | { readonly atMs: number; readonly do: "seek"; readonly toMs: number }
  | { readonly atMs: number; readonly do: "link"; readonly state: LinkStateName };

export interface Scenario {
  /** The recorded snapshot to start from (`FIXTURES`): its class, link state and status. */
  readonly fixture: string;
  /** The class time at the start; the fixture's when absent. */
  readonly startMs?: number;
  /** Every song's tempo, to run the count at another speed. */
  readonly bpm?: number;
  /** Two intervals of 0.3 s and 0.4 s start at this class time (a sub-second collision). */
  readonly tinyAtMs?: number;
  readonly events: readonly TimelineEvent[];
}

export interface Timeline {
  /** The snapshot at `tMs` on the page's clock; call with a time that never goes back. */
  inputAt(tMs: number): RoomInput;
}

const patched = (doc: Class, s: Scenario): Class => {
  let out = doc;
  if (s.bpm !== undefined) {
    const bpm = s.bpm;
    out = { ...out, songs: out.songs.map((x) => ({ ...x, bpm, ...(x.beat_anchors ? { beat_anchors: { quality: "measured" as const, anchors: [{ at_ms: 0, bpm }] } } : {}) })) as Class["songs"] };
  }
  if (s.tinyAtMs !== undefined) {
    const at = s.tinyAtMs;
    const k = out.intervals.findIndex((iv) => iv.start_ms <= at && at < iv.start_ms + iv.length_ms);
    const iv = out.intervals[k];
    const cut = [{ ...iv, length_ms: 300, zone: 5 }, { ...iv, start_ms: iv.start_ms + 300, length_ms: 400, zone: 6 }, { ...iv, start_ms: iv.start_ms + 700, length_ms: iv.length_ms - 700 }];
    out = { ...out, intervals: [...out.intervals.slice(0, k), ...cut, ...out.intervals.slice(k + 1)] as Class["intervals"] };
  }
  return out;
};

/** The player's count at a class time: the side, the beat on it and the beats left (what `patternSnapshotAt` sends). */
export function patternAt(doc: Class, classMs: number): PatternInput | null {
  const i = doc.intervals.findIndex((iv) => iv.start_ms <= classMs && classMs < iv.start_ms + iv.length_ms);
  const song = doc.songs.find((x) => x.start_ms <= classMs && classMs < x.end_ms);
  const pat = i < 0 ? undefined : doc.intervals[i].pattern;
  if (!pat || !song?.bpm) return null;
  // The count steps on the song's own grid (`pattern.ts`): the beat onsets after the interval's start, counted from the song's start.
  const beat = 60_000 / song.bpm;
  const onset = (ms: number): number => Math.floor((ms - song.start_ms) / beat + 1e-9);
  const n = onset(classMs) - onset(doc.intervals[i].start_ms);
  const cycle = pat.beats.reduce((a, b) => a + b, 0);
  let r = n % cycle;
  for (let k = 0; k < pat.beats.length; k += 1) {
    if (r < pat.beats[k]) return { position: pat.positions[k], beat: r + 1, beatsLeft: pat.beats[k] - r, nextPosition: pat.positions[(k + 1) % pat.positions.length] };
    r -= pat.beats[k];
  }
  return null;
}

export function createTimeline(s: Scenario): Timeline {
  const base = FIXTURES[s.fixture];
  if (!base?.doc || !base.view) throw new Error(`no snapshot ${s.fixture}`);
  const doc = patched(base.doc, s);
  const state0 = base.link?.state ?? "Locked";
  let [refT, refMs, status, state]: [number, number, ClockStatus, LinkStateName] = [0, s.startMs ?? base.view.classMs, base.view.status, state0];
  const pending = [...s.events].sort((a, b) => a.atMs - b.atMs);
  const classAt = (t: number): number => (status === "running" ? refMs + (t - refT) : refMs);

  return {
    inputAt(tMs) {
      while (pending.length && pending[0].atMs <= tMs) {
        const e = pending.shift()!;
        refMs = classAt(e.atMs);
        refT = e.atMs;
        if (e.do === "pause") [status, state] = ["paused", base.link?.mode === "manual" ? state : "Paused"];
        else if (e.do === "resume") [status, state] = ["running", state0];
        else if (e.do === "start") status = "running";
        else if (e.do === "seek") refMs = e.toMs;
        else if (e.do === "link") state = e.state;
      }
      const classMs = Math.round(classAt(tMs));
      const ended = classMs >= doc.class.length_ms;
      const view = clockAt(doc, ended ? doc.class.length_ms : classMs, ended ? "ended" : status);
      const link = linkAt(view, state, base.link ? { mode: base.link.mode, available: base.link.available } : {});
      return { ...base, doc, view, link, pattern: status === "running" && !ended ? patternAt(doc, classMs) : null };
    },
  };
}
