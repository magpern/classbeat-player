// Spike 1's pass table (plan section 12) over a replayed log. Pure: no I/O.
//
// A log alone cannot prove a row that is judged against the reference recording. For those rows the
// table prints what the log shows (CHECK) and the number to compare. PASS and FAIL are given only
// where the log itself decides.
import type { Plan } from "../../../music-follower/src/core/class_plan.js";
import { DEFAULT_CONFIG } from "../../../music-follower/src/core/follower.js";
import type { LinkState } from "../../../music-follower/src/core/types.js";
import type { Replayed } from "./replay.js";

export type Verdict = "PASS" | "FAIL" | "CHECK";
export interface Row {
  what: string;
  verdict: Verdict;
  detail: string;
}

interface Span {
  state: LinkState;
  fromMs: number;
  toMs: number;
}

/** Consecutive runs of one link state, by the time of the poll that entered and the one that left. */
export function spans(r: Replayed): Span[] {
  const out: Span[] = [];
  for (const { monoMs, decision } of r.steps) {
    const last = out[out.length - 1];
    if (last && last.state === decision.state) last.toMs = monoMs;
    else {
      if (last) last.toMs = monoMs;
      out.push({ state: decision.state, fromMs: monoMs, toMs: monoMs });
    }
  }
  return out;
}

const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Clock minus the music's own place, for polls that follow a fresh reading of a class song. */
function offsets(plan: Plan, r: Replayed): { monoMs: number; diffMs: number }[] {
  const out: { monoMs: number; diffMs: number }[] = [];
  for (const { monoMs, reading, decision } of r.steps) {
    if (!reading || decision.songIndex === null || decision.matchedBy === null || decision.held) continue;
    if (decision.state !== "Locked" && decision.state !== "Paused") continue;
    const song = plan.songs[decision.songIndex];
    if (!song) continue;
    const place = reading.positionMs + (reading.state === "playing" ? monoMs - reading.readAtMs : 0);
    out.push({ monoMs, diffMs: decision.classTimeMs - (song.startMs + place) });
  }
  return out;
}

/** The longest time the clock stayed more than `limitMs` off, from first to last such poll. */
function longestOff(o: { monoMs: number; diffMs: number }[], limitMs: number): number {
  let best = 0;
  let from: number | null = null;
  let prev = 0;
  for (const p of o) {
    if (Math.abs(p.diffMs) > limitMs) {
      if (from === null) from = p.monoMs;
      prev = p.monoMs;
      best = Math.max(best, prev - from);
    } else from = null;
  }
  return best;
}

export function passTable(plan: Plan, r: Replayed): Row[] {
  const sp = spans(r);
  const of = (st: LinkState) => sp.filter((x) => x.state === st);
  const ev = (name: string) => r.steps.filter((x) => x.decision.event === name).length;
  const rows: Row[] = [];

  const o = offsets(plan, r);
  const within = o.filter((p) => Math.abs(p.diffMs) <= 1000).length;
  const share = o.length === 0 ? 0 : (100 * within) / o.length;
  const off2 = longestOff(o, 2000);
  rows.push({
    what: "Interval timing",
    verdict: o.length === 0 ? "FAIL" : share >= 95 && off2 <= 5000 ? "PASS" : "FAIL",
    detail: `${share.toFixed(1)} % of ${o.length} locked polls within 1 s of the music's own place; longest time over 2 s off ${s(off2)} (the log's own reading, not the recording)`,
  });

  const backwards = r.steps.filter((x, i) => {
    const prev = r.steps[i - 1];
    return prev && x.decision.classTimeMs < prev.decision.classTimeMs && x.decision.event !== "relock" && x.decision.event !== "undo";
  });
  rows.push({
    what: "Song changes",
    verdict: backwards.length === 0 ? "CHECK" : "FAIL",
    detail: `${ev("song_change")} changes seen; clock moved backwards ${backwards.length} times outside a re-lock or undo; detection delay is judged against the recording (marks: ${r.markers.filter((m) => m.key === "m").length})`,
  });

  rows.push({
    what: "Pause and resume, seek, next and previous",
    verdict: "CHECK",
    detail: `pause ${ev("pause")}, resume ${ev("resume")}, seek ${ev("seek")}, song change ${ev("song_change")}, re-lock ${ev("relock")}; Paused spans ${of("Paused").length}; check "locked again within 3 s" at each mark`,
  });

  const amb = of("Ambiguous");
  rows.push({
    what: "The same recording twice in one class",
    verdict: "CHECK",
    detail: `Ambiguous spans ${amb.length}${amb.length ? " (" + amb.map((x) => s(x.toMs - x.fromMs)).join(", ") + ")" : ""}, resolved ${ev("resolved")}; check the right occurrence was chosen`,
  });

  const off = of("Off the list");
  rows.push({
    what: "A song that is not in the class; an advert; another app playing",
    verdict: "CHECK",
    detail: `Off the list spans ${off.length}${off.length ? " (" + off.map((x) => s(x.toMs - x.fromMs)).join(", ") + ")" : ""}; check each began within 3 s of the change and the clock locked again on return`,
  });

  const coast = of("Coasting");
  const stale = r.steps.filter((x) => x.decision.state === "Locked" && x.decision.readingAgeMs !== null && x.decision.readingAgeMs > DEFAULT_CONFIG.staleMs).length;
  rows.push({
    what: "The music app closed and restarted; readings going stale",
    verdict: stale > 0 ? "FAIL" : "CHECK",
    detail: `Coasting spans ${coast.length}${coast.length ? " (" + coast.map((x) => s(x.toMs - x.fromMs)).join(", ") + ")" : ""}; stale readings applied as current: ${stale}; Coasting is entered after ${s(DEFAULT_CONFIG.staleMs)} without a fresh poll, left on the first fresh one`,
  });

  const announced = r.steps.filter((x) => x.decision.announce !== null);
  const undos = r.decisions.filter((x) => x.kind === "undo").length;
  const relinks = r.decisions.filter((x) => x.kind === "relink").length;
  rows.push({
    what: "Readings lost while the music is paused for 30 s, then restored",
    verdict: "CHECK",
    detail: `announced corrections ${announced.length}${announced.length ? ": " + announced.map((x) => x.decision.announce).join("; ") : ""}; undo pressed ${undos}, relink ${relinks}`,
  });

  rows.push({
    what: "Readings lost while the music keeps playing for 30 s, then restored",
    verdict: "CHECK",
    detail: `Coasting spans over 25 s: ${coast.filter((x) => x.toMs - x.fromMs >= 25_000).length}; the clock offset on return is in the interval row, and no announcement is expected`,
  });

  const first = r.steps[0]?.monoMs ?? 0;
  const lastMs = r.steps[r.steps.length - 1]?.monoMs ?? 0;
  const maxDrift = o.reduce((m, p) => Math.max(m, Math.abs(p.diffMs)), 0);
  rows.push({
    what: "An hour of play",
    verdict: "CHECK",
    detail: `log covers ${s(lastMs - first)}; largest clock offset from the music's own place ${s(maxDrift)}; a full hour is needed for this row`,
  });

  rows.push({
    what: "Beat effects (measured separately)",
    verdict: "CHECK",
    detail: `${r.markers.filter((m) => m.key === "b").length} beat taps logged; compare them with the recording`,
  });
  return rows;
}

export function formatTable(rows: Row[]): string {
  const w = Math.max(...rows.map((x) => x.what.length));
  return rows.map((x) => `${x.verdict.padEnd(5)} ${x.what.padEnd(w)}  ${x.detail}`).join("\n");
}
