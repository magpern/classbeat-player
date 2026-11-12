// Test helpers for the music link: a plan of songs, scripted music-app timelines and a runner that
// steps the link every 100 ms (like the shell's tick) and records what the screens would show.
import { createClock, positionAt, tick } from "../../src/core/clock/index.ts";
import type { ClockState } from "../../src/core/clock/index.ts";
import { initialLink, step, linkViewAt, createScriptedReader } from "../../src/core/link/index.ts";
import type { LinkConfig, LinkEvent, LinkModel, LinkPlan, Segment, TrackInfo } from "../../src/core/link/index.ts";
import type { CommandResult } from "../../src/core/link/commands.ts";
import { DEFAULT_LINK_CONFIG } from "../../src/core/link/types.ts";
import type { LinkView } from "../../src/core/link/index.ts";

export const SONG_MS = 180_000;
export const CROSSFADE_MS = 9000;

/** A track the music app reports for song `name` (title "Song X", artist "Band X"). */
export const track = (name: string, lengthMs = SONG_MS): TrackInfo => ({ title: `Song ${name}`, artist: `Band ${name}`, lengthMs });

/**
 * A class of songs of 180 s each. Song k owns the window from its start to the next song's start
 * (length minus the crossfade); the last one owns its whole length (ADR 0001 rule 1).
 */
export function makePlan(names: readonly string[], crossfadeMs = CROSSFADE_MS): LinkPlan {
  let start = 0;
  const songs = names.map((n, index) => {
    const last = index === names.length - 1;
    const end = start + SONG_MS - (last ? 0 : crossfadeMs);
    const s = { index, title: `Song ${n}`, artist: `Band ${n}`, lengthMs: SONG_MS, startMs: start, endMs: end, trackIds: [] as string[] };
    start = end;
    return s;
  });
  return { songs, plannedCrossfadeMs: crossfadeMs, manualOnly: false };
}

export const classLength = (plan: LinkPlan): number => plan.songs[plan.songs.length - 1]?.endMs ?? 600_000;

/** The music app plays `name` from `pos` at time `from`. */
export const play = (from: number, name: string, pos: number, extra: Partial<Segment> = {}): Segment => ({ from, track: track(name), positionMs: pos, playing: true, ...extra });
export const pauseAt = (from: number, name: string, pos: number, extra: Partial<Segment> = {}): Segment => ({ from, track: track(name), positionMs: pos, playing: false, ...extra });

export interface Row {
  readonly now: number;
  readonly state: LinkModel["state"];
  readonly classMs: number;
  readonly status: ClockState["status"];
  readonly events: readonly LinkEvent[];
  readonly link: LinkModel;
  readonly view: LinkView;
}

export interface Action {
  readonly at: number;
  readonly run: (link: LinkModel, clock: ClockState, now: number) => CommandResult;
}

export interface RunOptions {
  readonly plan: LinkPlan;
  readonly segments: readonly Segment[];
  readonly until: number;
  readonly from?: number;
  readonly stepMs?: number;
  readonly actions?: readonly Action[];
  readonly cfg?: LinkConfig;
  readonly link?: LinkModel;
  readonly clock?: ClockState;
}

export interface Trace {
  readonly rows: readonly Row[];
  readonly at: (now: number) => Row;
}

export function run(o: RunOptions): Trace {
  const reader = createScriptedReader(o.segments);
  const stepMs = o.stepMs ?? 100;
  const from = o.from ?? 0;
  let link = o.link ?? initialLink(true);
  let clock = o.clock ?? createClock(classLength(o.plan), from);
  const pending = [...(o.actions ?? [])].sort((a, b) => a.at - b.at);
  const rows: Row[] = [];
  for (let now = from; now <= o.until; now += stepMs) {
    const events: LinkEvent[] = [];
    while (pending.length > 0 && pending[0].at <= now) {
      const r = pending.shift()!.run(link, clock, now);
      link = r.link;
      clock = r.clock;
      if (r.event) events.push(r.event);
    }
    const r = step(link, clock, o.plan, reader.latest(now), now, o.cfg ?? DEFAULT_LINK_CONFIG);
    link = r.link;
    clock = tick(r.clock, now);
    if (r.event) events.push(r.event);
    rows.push({ now, state: link.state, classMs: positionAt(clock, now), status: clock.status, events, link, view: linkViewAt(link, clock, o.plan, classLength(o.plan), now, true) });
  }
  return {
    rows,
    at: (now) => {
      const r = rows.find((x) => x.now === now);
      if (!r) throw new Error(`no row at ${now}`);
      return r;
    },
  };
}

/** Every event in [from, to]. */
export const eventsBetween = (t: Trace, from: number, to: number): LinkEvent[] => t.rows.filter((r) => r.now >= from && r.now <= to).flatMap((r) => [...r.events]);

/** Rule 4: the clock never moves backwards by itself. Returns the rows where it did. */
export function backwardSteps(t: Trace): Row[] {
  return t.rows.filter((r, i) => i > 0 && r.classMs < t.rows[i - 1].classMs);
}
