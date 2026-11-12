// Following the music (ADR 0001, timing model and link states). Pure and immutable: one step
// takes the link model, the class clock, the plan, the latest reading and a monotonic `now`, and
// returns the new model and clock. Call it often (the shell does at every tick) with the reader's
// latest reading; it works from the reading's own time (rule 8) and never needs a new reading to
// advance.
import { positionAt } from "../clock/clock.ts";
import type { ClockState } from "../clock/clock.ts";
import { positionNow } from "../clock/music-link.ts";
import { runOn, setClock, setRunning } from "./clock-moves.ts";
import { choose } from "./choose.ts";
import { measureCrossfade } from "./crossfade.ts";
import { classify, resyncText } from "./events.ts";
import { matchCandidates } from "./match.ts";
import { holdRemainingMs } from "./totals.ts";
import { DEFAULT_LINK_CONFIG, FOLLOWING } from "./types.ts";
import type { LinkConfig, LinkEvent, LinkModel, LinkPlan, LinkStateName, Observation } from "./types.ts";

export interface StepResult {
  readonly link: LinkModel;
  readonly clock: ClockState;
  readonly event: LinkEvent | null;
}

/** A move the instructor can no longer undo once a newer one has happened. */
const SUPERSEDING: readonly LinkEvent[] = ["song_change", "seek", "backward"];

/** Rule 8: a reading is current only while its reader keeps delivering. */
export const isCurrent = (o: Observation, now: number, staleMs: number): boolean => now - o.seenAt <= staleMs && now >= o.seenAt;

export function step(link: LinkModel, clock: ClockState, plan: LinkPlan, obs: Observation | null, now: number, cfg: LinkConfig = DEFAULT_LINK_CONFIG): StepResult {
  const l: LinkModel = {
    ...link,
    announce: link.announce && now <= link.announce.until ? link.announce : null,
    undo: link.undo && now <= link.undo.until ? link.undo : null,
  };
  if (l.mode === "manual" || plan.manualOnly) return { link: { ...l, state: "Manual" }, clock, event: null };
  if (obs === null || !isCurrent(obs, now, cfg.staleMs)) return coast(l, clock, now);
  const cands = matchCandidates(plan, obs, cfg);
  return cands.length === 0 ? offList(l, clock, now) : follow(l, clock, plan, obs, cands, now, cfg);
}

function coast(l: LinkModel, clock: ClockState, now: number): StepResult {
  if (!l.everLocked) return { link: { ...l, state: "Manual" }, clock, event: null };
  if (l.state === "Coasting") return { link: l, clock, event: null };
  const c = FOLLOWING.includes(l.state) ? runOn(clock, now) : clock;
  return { link: { ...l, state: "Coasting", held: false, holdUntil: null }, clock: c, event: "coasting" };
}

function offList(l: LinkModel, clock: ClockState, now: number): StepResult {
  if (l.state === "Off the list") return { link: l, clock, event: null };
  const c = l.everLocked && FOLLOWING.includes(l.state) ? runOn(clock, now) : clock;
  return { link: { ...l, state: "Off the list", songIndex: null, held: false, holdUntil: null }, clock: c, event: "off_list" };
}

function follow(l: LinkModel, clock: ClockState, plan: LinkPlan, obs: Observation, cands: number[], now: number, cfg: LinkConfig): StepResult {
  const clockMs = positionAt(clock, now);
  const posMs = Math.max(0, positionNow(obs, now));
  const choice = choose({ plan, candidates: cands, amb: l.amb, continuing: l.state === "Ambiguous", pick: l.pick, lastSong: l.lastSong, posMs, clockMs });
  const song = plan.songs[choice.index];
  const raw = song.startMs + posMs;
  const held = raw > song.endMs; // rule 2: never beyond the end of the window
  const target = Math.min(raw, song.endMs);
  const deltaMs = target - clockMs;
  const prev = l.state;
  const firstLock = !l.everLocked && clock.status === "ready";
  const resync = !firstLock && (prev === "Coasting" || prev === "Off the list" || prev === "Manual" || (prev === "Ambiguous" && !choice.ambiguous));
  // Rule 4: a small backward step is the measuring error and is not applied; but never past a window's end (rule 2).
  const small = deltaMs < 0 && -deltaMs <= cfg.backwardToleranceMs;
  const smoothed = !l.force && !held && small;
  const running = obs.playing && !held;
  const next: LinkStateName = choice.ambiguous ? "Ambiguous" : obs.playing ? "Locked" : "Paused";
  const event = classify({ prev, next, prevSong: l.songIndex, nextSong: choice.index, firstLock, resync, ambiguous: choice.ambiguous, deltaMs, smoothed: !l.force && small }, cfg);

  const announced = resync && !l.force && Math.abs(deltaMs) > cfg.announceMs; // rule 5
  const superseded = event !== null && SUPERSEDING.includes(event);
  let measured = l.measuredCrossfadeMs;
  if (!choice.ambiguous && l.lastPlayed && choice.index === l.lastPlayed.songIndex + 1) {
    measured = measureCrossfade(plan.songs[l.lastPlayed.songIndex], l.lastPlayed.obs, obs) ?? measured;
  }
  const isLast = choice.index === plan.songs.length - 1;
  const link: LinkModel = {
    ...l,
    state: next,
    everLocked: true,
    songIndex: choice.index,
    lastSong: choice.ambiguous ? l.lastSong : choice.index,
    amb: choice.ambiguous ? { candidates: cands, index: choice.index } : null,
    pick: l.pick !== null && cands.length > 1 && cands.includes(l.pick) ? l.pick : null,
    force: false,
    held,
    holdUntil: held ? now + holdRemainingMs(song.lengthMs, posMs, measured ?? plan.plannedCrossfadeMs, isLast) : null,
    announce: announced ? { text: resyncText(deltaMs), deltaMs, until: now + cfg.undoWindowMs } : superseded ? null : l.announce,
    undo: announced ? { clockMs, at: now, until: now + cfg.undoWindowMs } : superseded ? null : l.undo,
    lastPlayed: choice.ambiguous ? l.lastPlayed : { songIndex: choice.index, obs },
    measuredCrossfadeMs: measured,
  };
  const out = smoothed ? setRunning(clock, running, now) : setClock(clock, target, running, now);
  return { link, clock: out, event };
}
