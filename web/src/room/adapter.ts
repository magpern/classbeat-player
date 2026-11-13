// The typed adapter: a snapshot (the open class, the clock view, the music link view) becomes the
// room screen's model. Pure; nothing here reads the DOM, a clock or the network, so every state
// is a function of its input and is tested as one.
import { beatPeriodMs, canShowBeat, cueIsLong } from "./fit.ts";
import { cadenceText, clockText, classTimeText, countdownIsWide, countdownText, positionText, targetTexts, zoneDef } from "./format.ts";
import type { Class, LinkInput, RoomInput } from "./input.ts";
import { beforeStartIntro, completeGel, finishedIntro, firstZoneGel } from "./intro-model.ts";
import { countLabel, linkPlate, pauseLine } from "./link-text.ts";
import type { BeatModel, ClockLine, ClockModel, GelModel, MetricModel, NextModel, RoomModel } from "./model.ts";
import { layoutScore, songBpm } from "./score.ts";

type View = NonNullable<RoomInput["view"]>;
type Song = Class["songs"][number];

const EMPTY: RoomModel = {
  kind: "empty",
  gel: null,
  rail: { left: null, done: null, segment: null, link: null },
  clock: null,
  metrics: [],
  beat: null,
  cue: null,
  next: null,
  intro: null,
  score: null,
  intervalKey: "",
  classMs: 0,
  moving: false,
};

export function toRoomModel(input: RoomInput): RoomModel {
  const { doc, view, link } = input;
  if (!doc || !view || doc.intervals.length === 0) return EMPTY;
  const finished = view.status === "ended" || view.classMs >= view.lengthMs;
  const before = !finished && view.status === "ready" && view.classMs <= 0;
  if (finished) return outside("finished", doc, view, link);
  if (before) return outside("before-start", doc, view, link);
  return running(doc, view, link);
}

function scoreFor(doc: Class, view: View, link: LinkInput | null) {
  const ambiguity = link?.state === "Ambiguous" && link.candidates.length > 1 ? link.candidates : null;
  return layoutScore({
    classMs: view.classMs,
    lengthMs: view.lengthMs,
    intervals: doc.intervals,
    songs: doc.songs,
    zoneName: (z) => zoneDef(doc, z)?.name ?? "",
    ambiguity,
    unsure: link?.guessing ?? false,
  });
}

function outside(kind: "finished" | "before-start", doc: Class, view: View, link: LinkInput | null): RoomModel {
  const finished = kind === "finished";
  return {
    ...EMPTY,
    kind,
    gel: finished ? completeGel(doc) : firstZoneGel(doc),
    rail: { left: null, done: null, segment: null, link: linkPlate(doc, link, view, finished) },
    intro: finished ? finishedIntro(doc) : beforeStartIntro(doc),
    score: scoreFor(doc, view, link),
    intervalKey: kind,
    classMs: view.classMs,
  };
}

function running(doc: Class, view: View, link: LinkInput | null): RoomModel {
  const iv = doc.intervals[Math.min(view.intervalIndex, doc.intervals.length - 1)];
  const paused = link?.state === "Paused" || view.status === "paused";
  const song = songOf(doc, view, link);
  const def = zoneDef(doc, iv.zone);
  const name = def?.name ?? "";
  const gel: GelModel = { look: paused ? "down" : "zone", zone: iv.zone, label: "Zone", numeral: String(iv.zone), name, targets: targetTexts(def) };
  const segment = doc.segments?.find((s) => view.classMs >= s.start_ms && view.classMs < s.end_ms)?.name ?? null;
  const following = link?.mode === "following";
  const left = following ? link.classRemainingMs : view.classRemainingMs;
  return {
    kind: "running",
    gel,
    rail: { left: classTimeText(left), done: classTimeText(view.classMs), segment, link: linkPlate(doc, link, view, true) },
    clock: clockFor(doc, view, link, paused, song),
    metrics: metricsFor(iv, song, link),
    beat: beatFor(view, link, song),
    cue: iv.cue.trim() ? { text: iv.cue, long: cueIsLong(iv.cue) } : null,
    next: nextFor(doc, view),
    intro: null,
    score: scoreFor(doc, view, link),
    intervalKey: `running:${view.intervalIndex}`,
    classMs: view.classMs,
    moving: view.status === "running" && !paused && !(link?.held ?? false),
  };
}

function songOf(doc: Class, view: View, link: LinkInput | null): Song | null {
  const i = link?.mode === "following" ? (link.songIndex ?? view.songIndex) : view.songIndex;
  return i === null ? null : (doc.songs[i] ?? null);
}

function clockFor(doc: Class, view: View, link: LinkInput | null, paused: boolean, song: Song | null): ClockModel {
  const iv = doc.intervals[Math.min(view.intervalIndex, doc.intervals.length - 1)];
  const held = link?.held === true && link.holdRemainingMs !== null;
  const remaining = held && link?.holdRemainingMs != null ? link.holdRemainingMs : view.intervalRemainingMs;
  const guessing = link?.guessing ?? false;
  const last = view.nextIntervalIndex === null;
  const ftp = iv.test?.kind === "ftp";
  return {
    label: paused ? "" : countLabel({ held, lastInterval: last, remainingMs: remaining, guessing }),
    ftpTag: ftp,
    pill: paused,
    count: countdownText(remaining),
    wide: countdownIsWide(iv.length_ms),
    estimated: guessing,
    line: paused ? { kind: "text", text: pauseLine(link) } : held ? null : lineFor(view, link, song, last),
  };
}

/** Bars to the change while it lies inside the playing song; else the time to the next song. */
function lineFor(view: View, link: LinkInput | null, song: Song | null, last: boolean): ClockLine | null {
  // A guess is not counted in bars, and the manual clock measures no song.
  if (link?.mode !== "following" || link.guessing || !song) return null;
  const bpm = songBpm(song);
  const changeMs = view.classMs + view.intervalRemainingMs;
  if (bpm && changeMs <= song.end_ms) {
    const count = Math.floor((view.intervalRemainingMs / 1000) * (bpm / 240));
    return { kind: "bars", count, tail: `${count === 1 ? "bar" : "bars"} to the ${last ? "end" : "change"}` };
  }
  return { kind: "song", time: clockText(song.end_ms - view.classMs) };
}

function metricsFor(iv: Class["intervals"][number], song: Song | null, link: LinkInput | null): MetricModel[] {
  const cadence = cadenceText(iv);
  const bpm = song ? songBpm(song) : null;
  return [
    { label: "Cadence", value: cadence?.value ?? "–", unit: cadence?.unit ?? null },
    { label: "Position", value: positionText(iv) ?? "–", unit: null },
    { label: link?.state === "Off the list" ? "Song, planned" : "Song", value: bpm ? String(Math.round(bpm)) : "–", unit: bpm ? "bpm" : null },
  ];
}

function beatFor(view: View, link: LinkInput | null, song: Song | null): BeatModel | null {
  // Only while the link is locked and the song has its own beat anchors; the beats come from the
  // anchors (the anchor in force now), not from the song's listed BPM.
  if (link?.state !== "Locked" || link.held || !song) return null;
  const anchors = song.beat_anchors;
  if (!anchors || anchors.quality === "missing" || anchors.anchors.length === 0) return null;
  const rel = view.classMs - song.start_ms;
  const anchor = [...anchors.anchors].reverse().find((x) => x.at_ms <= rel) ?? anchors.anchors[0];
  if (!canShowBeat(anchor.bpm, true)) return null;
  // Lights fall on every k-th beat counted from the anchor: the period is k beats, exactly.
  const period = beatPeriodMs(anchor.bpm);
  const sinceAnchor = rel - anchor.at_ms;
  const toNext = period - (((sinceAnchor % period) + period) % period);
  return { periodMs: period, phaseMs: toNext, key: `${song.start_ms}:${anchor.at_ms}:${anchor.bpm}` };
}

function nextFor(doc: Class, view: View): NextModel {
  if (view.nextIntervalIndex === null) return { end: true, zone: 0, name: "", length: "", cadence: null, position: null };
  const nx = doc.intervals[view.nextIntervalIndex];
  const cadence = cadenceText(nx);
  return {
    end: false,
    zone: nx.zone,
    name: zoneDef(doc, nx.zone)?.name ?? "",
    length: clockText(nx.length_ms),
    cadence: cadence ? [cadence.value, cadence.unit].filter(Boolean).join(" ") : null,
    position: positionText(nx),
  };
}
