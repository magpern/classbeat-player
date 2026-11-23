// The typed adapter: a snapshot (the open class, the clock view, the music link view) becomes the
// room screen's model. Pure; nothing here reads the DOM, a clock or the network, so every state
// is a function of its input and is tested as one.
import { cueIsLong } from "./fit.ts";
import { cadenceText, clockText, classTimeText, countdownIsWide, countdownText, positionText, targetTexts, zoneDef } from "./format.ts";
import type { Class, LinkInput, PatternInput, PlayNotice, RoomInput } from "./input.ts";
import { beforeStartIntro, completeGel, finishedIntro, firstZoneGel } from "./intro-model.ts";
import { countLabel, linkPlate, pauseLine } from "./link-text.ts";
import { isNoTempo, patternText, patternValue, patternWords } from "./pattern-model.ts";
import type { ClockLine, ClockModel, GelModel, MetricModel, NextModel, PatternValue, RoomModel, CountModel } from "./model.ts";
import { mergedView } from "./merge-view.ts";
import { layoutScore, songBpm } from "./score.ts";
import { LANDSCAPE_SCALE } from "./score-scale.ts";
import type { ScoreScale } from "./score-scale.ts";

type View = NonNullable<RoomInput["view"]>;
type Song = Class["songs"][number];
type Interval = Class["intervals"][number];

const EMPTY: RoomModel = {
  kind: "empty",
  gel: null,
  rail: { left: null, done: null, segment: null, link: null },
  clock: null,
  metrics: [],
  count: null,
  cue: null,
  next: null,
  intro: null,
  score: null,
  intervalKey: "",
  classMs: 0,
  moving: false,
  changeInMs: null,
};

export function toRoomModel(input: RoomInput, scale: ScoreScale = LANDSCAPE_SCALE): RoomModel {
  const notice = input.notice ?? null;
  const { doc, link } = input;
  if (!doc || !input.view || doc.intervals.length === 0) return EMPTY;
  // Interval changes less than 1 s apart are one change frame: it shows the latest of them (room-2d.md, "Merged intervals").
  const view = mergedView(doc, input.view);
  const finished = view.status === "ended" || view.classMs >= view.lengthMs;
  const before = !finished && view.status === "ready" && (view.classMs <= 0 || input.startingPoint === true);
  if (finished) return outside("finished", doc, view, link, notice, scale);
  if (before) return outside("before-start", doc, view, link, notice, scale, input.playlistNotLoaded === true);
  return running(doc, view, link, notice, scale, input.playlistNotLoaded === true, input.pattern ?? null);
}

function scoreFor(doc: Class, view: View, link: LinkInput | null, scale: ScoreScale) {
  const ambiguity = link?.state === "Ambiguous" && link.candidates.length > 1 ? link.candidates : null;
  return layoutScore({
    classMs: view.classMs,
    lengthMs: view.lengthMs,
    intervals: doc.intervals,
    songs: doc.songs,
    zoneName: (z) => zoneDef(doc, z)?.name ?? "",
    ambiguity,
    unsure: link?.guessing ?? false,
    scale,
  });
}

function outside(kind: "finished" | "before-start", doc: Class, view: View, link: LinkInput | null, notice: PlayNotice | null, scale: ScoreScale, playlistNotLoaded = false): RoomModel {
  const finished = kind === "finished";
  return {
    ...EMPTY,
    kind,
    gel: finished ? completeGel(doc) : firstZoneGel(doc, view.intervalIndex),
    rail: { left: null, done: null, segment: null, link: linkPlate(doc, link, view, finished, notice, playlistNotLoaded && !finished) },
    intro: finished ? finishedIntro(doc) : beforeStartIntro(doc),
    score: scoreFor(doc, view, link, scale),
    intervalKey: kind,
    classMs: view.classMs,
  };
}

function running(doc: Class, view: View, link: LinkInput | null, notice: PlayNotice | null, scale: ScoreScale, playlistNotLoaded: boolean, pattern: PatternInput | null): RoomModel {
  const iv = doc.intervals[Math.min(view.intervalIndex, doc.intervals.length - 1)];
  const paused = link?.state === "Paused" || view.status === "paused";
  const song = songOf(doc, view, link);
  const def = zoneDef(doc, iv.zone);
  const name = def?.name ?? "";
  const gel: GelModel = { look: paused ? "down" : "zone", zone: iv.zone, label: "Zone", numeral: String(iv.zone), name, targets: targetTexts(def) };
  const segment = doc.segments?.find((s) => view.classMs >= s.start_ms && view.classMs < s.end_ms)?.name ?? null;
  const following = link?.mode === "following";
  const left = following ? link.classRemainingMs : view.classRemainingMs;
  const position = patternValue(iv, song, link, pattern, view.status === "running");
  const moving = view.status === "running" && !paused && !(link?.held ?? false);
  return {
    kind: "running",
    gel,
    rail: { left: classTimeText(left), done: classTimeText(view.classMs), segment, link: linkPlate(doc, link, view, true, notice, playlistNotLoaded) },
    clock: clockFor(doc, view, link, paused, song, isNoTempo(position)),
    metrics: metricsFor(iv, song, link, position),
    count: countFor(position, song, iv, view.classMs),
    cue: iv.cue.trim() ? { text: iv.cue, long: cueIsLong(iv.cue) } : null,
    next: nextFor(doc, view),
    intro: null,
    score: scoreFor(doc, view, link, scale),
    intervalKey: `running:${view.intervalIndex}`,
    classMs: view.classMs,
    moving,
    changeInMs: moving ? view.intervalRemainingMs : null,
  };
}

function songOf(doc: Class, view: View, link: LinkInput | null): Song | null {
  const i = link?.mode === "following" ? (link.songIndex ?? view.songIndex) : view.songIndex;
  return i === null ? null : (doc.songs[i] ?? null);
}

function clockFor(doc: Class, view: View, link: LinkInput | null, paused: boolean, song: Song | null, noTempo: boolean): ClockModel {
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
    // A pattern on a song with no tempo has no bars line (room-2d.md, "No tempo").
    line: paused ? { kind: "text", text: pauseLine(link) } : held || noTempo ? null : lineFor(view, link, song, last),
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

function metricsFor(iv: Class["intervals"][number], song: Song | null, link: LinkInput | null, position: PatternValue | null): MetricModel[] {
  const cadence = cadenceText(iv);
  // A song with no `bpm` in a pattern interval reads "–", whatever its anchors say.
  const bpm = song && !isNoTempo(position) ? songBpm(song) : null;
  const songLabel = isNoTempo(position) ? "Song, no tempo" : link?.state === "Off the list" ? "Song, planned" : "Song";
  return [
    { label: "Cadence", value: cadence?.value ?? "–", unit: cadence?.unit ?? null },
    position ? { label: "Position", value: patternText(position), unit: null, pattern: position } : { label: "Position", value: positionText(iv) ?? "–", unit: null },
    { label: songLabel, value: bpm ? String(Math.round(bpm)) : "–", unit: bpm ? "bpm" : null },
  ];
}

/**
 * The count's beat and when its side ends (the switch beat), while a count is shown. The player counts; this only says how
 * fast it steps and where the beats fall: on the interval's start for a pattern that starts with the interval, on the song's
 * beat anchors for one that starts on the next downbeat.
 */
function countFor(position: PatternValue | null, song: Song | null, iv: Interval, classMs: number): CountModel | null {
  const bpm = song ? songBpm(song) : null;
  if (position?.kind !== "count" || !song || !bpm) return null;
  const beatMs = 60_000 / bpm;
  const anchors = song.beat_anchors?.anchors;
  const anchor = anchors && [...anchors].reverse().find((x) => song.start_ms + x.at_ms <= classMs);
  const origin = iv.pattern?.start_on === "next_downbeat" && anchor ? song.start_ms + anchor.at_ms : iv.start_ms;
  const phase = (((classMs - origin) % beatMs) + beatMs) % beatMs;
  const beatsLeft = Number(position.count);
  return { beatMs, beatsLeft, switchInMs: beatsLeft * beatMs - phase };
}

function nextFor(doc: Class, view: View): NextModel {
  if (view.nextIntervalIndex === null) return { end: true, zone: 0, name: "", length: "", cadence: null, position: null, cue: null };
  const nx = doc.intervals[view.nextIntervalIndex];
  const cadence = cadenceText(nx);
  return {
    end: false,
    zone: nx.zone,
    name: zoneDef(doc, nx.zone)?.name ?? "",
    length: clockText(nx.length_ms),
    cadence: cadence ? [cadence.value, cadence.unit].filter(Boolean).join(" ") : null,
    position: nx.pattern ? patternWords(nx.pattern) : positionText(nx),
    cue: nx.cue.trim() ? nx.cue : null,
  };
}
