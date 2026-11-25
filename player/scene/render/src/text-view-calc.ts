// The running screen's text, decided (scene.md "Content, in priority order", S4): from the class,
// the class clock and the link, every string and size class of the nine items, so the DOM code only
// places them. Nothing here touches a beam, a colour or a clock (rules 4 and 7); the zone colour
// is named by the zone number alone and drawn from `tokens.css`. Pure.

import { beatLevel } from "../../model/src/index.ts";
import { cueSmall, fitNextRow, foldsPattern, layoutFor, nameSmall, nextCueLines, patternRoom } from "./text-fit-calc.ts";
import { patternState } from "./text-pattern-calc.ts";
import type { PatternState } from "./text-pattern-calc.ts";
import { scoreView } from "./text-score-calc.ts";
import type { TextInput, TextInterval, TextZone } from "./text-types.ts";
import type { ClockView, GelView, MetricView, NextView, PatternBlockView, RailView, TextView } from "./text-view.ts";
import { barsText, cadenceWords, classTimeText, clockText, countdownText, linkPlate, inclineWords, patternWords, positionWord, specForms } from "./text-words.ts";

const WIDE_COUNT_MS = 10 * 60_000;
/** Below this the block's count steps down to 14.6 vh (it is 16 vw at the least, else it folds). */
const COMPACT_BELOW_VW = 21;
const MAX_SQUARES = 8;

const zoneInfo = (zones: readonly TextZone[], zone: number): TextZone => zones.find((z) => z.zone === zone) ?? { zone, name: `Zone ${zone}`, targets: [] };

function intervalIndex(ivs: readonly TextInterval[], classMs: number): number {
  let at = 0;
  ivs.forEach((iv, i) => { if (iv.startMs <= classMs) at = i; });
  return at;
}

export function textView(input: TextInput): TextView {
  const { cls, classMs, songIndex, songPosMs, link, reducedMotion, aspect } = input;
  const notLoaded = input.playlistNotLoaded === true;
  const layout = layoutFor(aspect);
  const at = intervalIndex(cls.intervals, classMs);
  const iv = cls.intervals.at(at);
  if (iv === undefined) throw new RangeError("a class needs at least one interval");
  const nextIv = cls.intervals.at(at + 1) ?? null;
  const song = cls.songs.at(songIndex) ?? null;
  const level = beatLevel(link, song);
  const paused = link.state === "Paused";
  const estimated = link.state === "Coasting" || link.state === "Off the list";
  const remaining = Math.max(0, iv.startMs + iv.lengthMs - classMs);
  const last = nextIv === null;
  const zone = zoneInfo(cls.zones, iv.zone);
  const plate = linkPlate(link, cls, notLoaded);
  const state = patternState({ iv, song, level, classMs, songPosMs });

  const gel: GelView = { zone: iv.zone, look: paused ? "down" : "zone", numeral: String(iv.zone), name: zone.name, nameSmall: nameSmall(zone.name, layout, aspect), targets: zone.targets };
  const segment = cls.segments.filter((s) => s.startMs <= classMs).at(-1)?.name ?? null;
  const unstarted = link.started === false;
  const rail: RailView = { left: unstarted ? null : `${clockText(cls.endMs - classMs)} left`, done: unstarted ? null : `${classTimeText(classMs)} done`, segment: layout === "wide" && !plate.alert ? segment : null, link: { text: plate.text, alert: plate.alert }, kind: plate.kind };

  const bpm = song?.bpm;
  const bars = level === "Beat" && bpm !== undefined && !paused ? barsText(Math.floor((remaining * bpm) / 60_000 / 4), last) : null;
  const base = link.held === true ? "Until the next song" : remaining > 0 && remaining <= 5000 ? "Change in" : last ? "Last interval" : "Interval left";
  const clock: ClockView = {
    label: estimated && link.held !== true ? `${base}, estimated` : base, paused, bars, count: countdownText(remaining),
    wide: iv.lengthMs >= WIDE_COUNT_MS, estimated, pauseLine: paused ? "Starts again with the music" : null,
  };

  const cadence = cadenceWords(iv.cadence);
  const noTempo = state?.kind === "note" && bpm === undefined;
  const fold = iv.pattern !== null && (layout === "narrow" || foldsPattern({ aspect, countGlyphs: clock.wide ? 5 : 4, valueGlyphs: cadence.value.length, unitGlyphs: cadence.unit?.length ?? 0 }));
  const songLabel = link.state === "Off the list" ? "Song, planned" : noTempo ? "Song, no tempo" : "Song";
  // A running interval has an incline and no cadence or position: one "Target" metric takes both places (running-class.md, item 1).
  const own: readonly MetricView[] = iv.incline !== undefined
    ? [{ key: "target", label: "Target", value: inclineWords(iv.incline), unit: null, folded: null }]
    : [
      { key: "cadence", label: "Cadence", value: cadence.value, unit: cadence.unit, folded: null },
      { key: "position", label: "Position", value: iv.pattern === null ? positionWord(iv.position) : "Up / down", unit: null, folded: fold ? state : null },
    ];
  const metrics: readonly MetricView[] = [
    ...own,
    { key: "song", label: songLabel, value: bpm === undefined ? "–" : String(Math.round(bpm)), unit: bpm === undefined ? null : "bpm", folded: null },
  ];
  const room = patternRoom({ aspect, countGlyphs: clock.wide ? 5 : 4, valueGlyphs: cadence.value.length, unitGlyphs: cadence.unit?.length ?? 0 });
  const pattern: PatternBlockView | null = iv.pattern === null || state === null || fold ? null : {
    label: patternWords(iv.pattern), state, compact: room < COMPACT_BELOW_VW,
    squares: state.kind === "count" && state.total <= MAX_SQUARES ? { total: state.total, left: state.left } : null,
  };

  const songMetric = metrics.at(-1);
  const fit = nextIv === null ? null : fitNextRow({
    layout, aspect, zoneName: zoneInfo(cls.zones, nextIv.zone).name, length: clockText(nextIv.lengthMs),
    specs: specForms(nextIv.cadence, nextIv.position, nextIv.pattern, nextIv.incline), song: { label: songMetric?.label ?? "Song", value: songMetric?.value ?? "", unit: songMetric?.unit ?? null },
  });
  const next: NextView = nextIv === null || fit === null
    ? { end: true, zone: iv.zone, zoneName: "End of class", length: "", spec: null, cue: null, leftVw: layout === "wide" ? 42 : 5, sizeVh: 4.6, cueLines: 0 }
    : { end: false, zone: nextIv.zone, zoneName: zoneInfo(cls.zones, nextIv.zone).name, length: clockText(nextIv.lengthMs), spec: fit.spec, cue: nextIv.cue === "" ? null : nextIv.cue, leftVw: fit.leftVw, sizeVh: fit.sizeVh, cueLines: nextCueLines({ layout, aspect, currentCue: iv.cue, nextCue: nextIv.cue, lineVh: fit.sizeVh }) };

  return { layout, reduced: reducedMotion, gel, rail, clock, metrics, pattern, cue: { text: iv.cue, small: cueSmall(iv.cue) }, next, score: scoreView(input, layout === "narrow") };
}

/** The Position metric's plain text, for a folded pattern (what a test or a screen reader reads). */
export function foldedText(state: PatternState): string {
  return state.kind === "count" ? `${state.side} ${state.left}` : state.kind === "soon" ? `${state.side}, ${state.text}` : state.text;
}
