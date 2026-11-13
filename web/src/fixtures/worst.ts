// The worst case of every text slot (docs/design/room-2d.md, "Fitting text", "Worst cases"): the
// longest content the format allows, checked at every supported size. One 188-interval class of
// 3:04:53 with 80-character zone, title, segment and song names; five snapshots of it.
import type { Class, RoomInput } from "../room/input.ts";
import { classOf, clockAt, intervalsFrom, linkAt, scaleOf, snapshot } from "./build.ts";

const NAMES = [
  "Recovery and very easy spinning, with loose legs and slow breathing all the way",
  "Endurance, the aerobic base for long steady rides at a conversational effort now",
  "Tempo, comfortably hard and steady, the pace you could hold for a whole hour now",
  "Functional threshold power, the hardest effort you can hold for about an hour",
  "Maximal aerobic power, the VO2 max efforts of three to eight minutes at a time",
  "Anaerobic capacity, short and very hard efforts well above your threshold power",
  "Neuromuscular power: all-out sprints of a few seconds, from a rolling start, go!",
];
// The widest capitals: seven names of 80 characters, alternately one word and many words of M and W.
const WIDE_WORD = "MW".repeat(40);
const WIDE_WORDS = "WOMB WHOM MOW MEW WAW MAW WHAM WOW MOM NOW WOMEN MOWN HMM WHOM WOW MOWN MEMO OW";
const WIDE_NAMES = [WIDE_WORD, WIDE_WORDS, WIDE_WORD, WIDE_WORDS, WIDE_WORD, WIDE_WORDS, WIDE_WORD];
const CUE_WIDE = "WHOA: MOVE WITH THE MUSIC. WOW, MOMENTUM NOW. MAXIMUM WORK, WIDE KNEES, MOW THE HILL. WE WIN WHEN WE MOVE AS ONE. WOW!";
const TITLE = "Thursday threshold builder: long climbing intervals with a final all-out finish";
const SEGMENT = "Main set, part two: the long climbing intervals before the final sprint finish!";
const CUE_LONG = "Uncompromisingly smooth: counterclockwise shoulders, breathe, recover, then accelerate progressively through the chorus.";
const CUE_CAPS = "UNCOMPROMISINGLY SMOOTH: COUNTERCLOCKWISE SHOULDERS, BREATHE, RECOVER, THEN ACCELERATE PROGRESSIVELY THROUGH THE CHORUS.";
const CUE_60 = "Extraordinarily controlled, uninterrupted, wholehearted spin";

const LENGTH_S = 11_093; // 3:04:53
const TEST_START_S = 3893; // a one-hour test interval: 58:58 left at 1:05:55
const NOW_MS = 3_955_000;

/** `n` equal intervals filling [fromS, toS), cycling through the zones; the last takes the rest. */
function filler(fromS: number, toS: number, n: number, firstZone: number): [number, number][] {
  const each = Math.floor((toS - fromS) / n);
  return Array.from({ length: n }, (_, i) => [i === n - 1 ? toS - fromS - each * (n - 1) : each, ((firstZone + i - 1) % 7) + 1] as [number, number]);
}

interface Worst {
  zone: number;
  nextCadence: Class["intervals"][number]["cadence"];
  nextPosition: "standing";
  shortZone4?: boolean;
  cue: string;
  /** Widest-glyph content (room-2d.md, the width-based fixtures): names, segment and title by width, not length. */
  wide?: boolean;
  /** The playing zone's name, whatever its length (the browser measures how it fits). */
  zoneName?: string;
}

function worstClass(o: Worst): Class {
  const names = o.wide ? WIDE_NAMES : [...NAMES];
  if (o.shortZone4) names[3] = "Functional threshold";
  if (o.zoneName) names[o.zone - 1] = o.zoneName;
  const scale = scaleOf(names, () => ({ ftp_pct: [105, 120], rpe: [9, 10], hrmax_pct: [92, 100] }));
  // 60 + the test + the next interval + 126 = 188 intervals.
  const parts: [number, number][] = [...filler(0, TEST_START_S, 60, 1), [3600, o.zone], [750, 7], ...filler(TEST_START_S + 3600 + 750, LENGTH_S, 126, 2)];
  const intervals = intervalsFrom(0, parts, "Hold the pace.");
  intervals[60] = { ...intervals[60], test: { kind: "ftp", minutes: 20 }, cue: o.cue, cadence: { from: 105, to: 120 }, position: "standing" };
  intervals[61] = { ...intervals[61], cadence: o.nextCadence, position: o.nextPosition };
  // 28 songs; the one playing at 1:05:55 is 3850 s long at 200 bpm and carries a Breakdown.
  const songs = Array.from({ length: 28 }, (_, i) => ({
    title: `Song number ${i + 1}`,
    artist: "Artist",
    length_ms: 1,
    start_ms: 0,
    end_ms: 1,
    bpm: 120,
  }));
  const tail = LENGTH_S * 1000 - 7_600_000;
  const bounds = [
    ...Array.from({ length: 10 }, (_, i) => i * 375_000),
    3_750_000,
    7_600_000,
    ...Array.from({ length: 16 }, (_, k) => 7_600_000 + Math.round(((k + 1) * tail) / 17)),
    LENGTH_S * 1000,
  ];
  songs.forEach((s, i) => {
    s.start_ms = bounds[i];
    s.end_ms = bounds[i + 1];
    s.length_ms = s.end_ms - s.start_ms;
  });
  const long = songs[10];
  Object.assign(long, {
    title: "The Extended Twelve-Inch Remix of a Very Long Song Title That Goes On and On",
    artist: "Orchestra of the Northern Lights and Friends",
    bpm: 200,
    beat_anchors: { quality: "measured", anchors: [{ at_ms: 0, bpm: 200 }] },
    moments: { quality: "measured", items: [{ at_ms: 375_000, kind: "breakdown" }] },
  });
  Object.assign(songs[11], { title: "Another Remarkably Long Title, Part Two: the Return of the Long Title Again", artist: "The Very Long Artist Name Collective", bpm: 174 });
  const segments = [{ name: o.wide ? WIDE_WORD : SEGMENT, kind: "main" as const, start_ms: 3_000_000, end_ms: 9_000_000 }];
  const doc = classOf(o.wide ? WIDE_WORD : TITLE, scale, intervals, songs as Class["songs"], segments, 388);
  return { ...doc, class: { ...doc.class, length_ms: LENGTH_S * 1000 } };
}

export const WORST_FIXTURES: Readonly<Record<string, RoomInput>> = (() => {
  const beat = { nextCadence: "beat" as const, nextPosition: "standing" as const };
  const offList = worstClass({ zone: 6, ...beat, cue: CUE_LONG });
  const running = worstClass({ zone: 3, nextCadence: { from: 105, to: 120 }, nextPosition: "standing", cue: CUE_60 });
  const paused = worstClass({ zone: 4, ...beat, cue: CUE_LONG, shortZone4: true });
  // 1:58:58 left in the class (the screen shows the link's figure while following).
  const left = { classRemainingMs: 7_138_000 };
  const view = (doc: Class) => ({ ...clockAt(doc, NOW_MS), ...left });
  const wide = worstClass({ zone: 7, ...beat, cue: CUE_WIDE, wide: true });
  const withAmbiguity = (doc: Class): RoomInput => {
    const v = view(doc);
    return { doc, view: v, link: linkAt(v, "Ambiguous", { ...left, candidates: [11, 10] }) };
  };
  const withLink = (doc: Class, state: Parameters<typeof linkAt>[1]): RoomInput => {
    const v = view(doc);
    return { doc, view: v, link: linkAt(v, state, left) };
  };
  return {
    "worst-off-list": withLink(offList, "Off the list"),
    "worst-running": withLink(running, "Locked"),
    "worst-paused": withLink(paused, "Paused"),
    // The occurrence marker beside 80-character song titles: the title gives way, the marker never.
    "worst-ambiguous": withAmbiguity(worstClass({ zone: 5, ...beat, cue: CUE_60 })),
    // Short names of the widest glyphs: one word that is too wide for the gel at 11 characters, and
    // three words that wrap to more lines than fit beside the targets.
    "worst-wide-word": withLink(worstClass({ zone: 4, ...beat, cue: CUE_60, zoneName: "MWMWMWMWMWM" }), "Locked"),
    "worst-wide-words": withLink(worstClass({ zone: 4, ...beat, cue: CUE_60, zoneName: "MWMWMW MWMWMW MWMWMW" }), "Locked"),
    // Widest glyphs: names, segment, title and cue by width, not by length.
    "worst-wide": withLink(wide, "Locked"),
    "worst-wide-before-start": snapshot(wide, 0, "Locked", "ready"),
    // Wide capitals: the cue that needs a fourth line at 3:2 and narrower.
    "worst-cue-caps": withLink(worstClass({ zone: 3, nextCadence: { from: 105, to: 120 }, nextPosition: "standing", cue: CUE_CAPS }), "Locked"),
    "worst-before-start": snapshot(running, 0, "Locked", "ready"),
    "worst-finished": snapshot(running, LENGTH_S * 1000, "Locked", "ended"),
  };
})();
