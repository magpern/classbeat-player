# Screen spec: the plain 2D room screen

Status: proposed in the pull request for issue #22. Design system: [system.md](system.md).
Reference mock-ups and screenshots: [mockups/](mockups/).

## Purpose

The screen the riders see on the projector or TV, and the first screen the product runs on
(plan section 3, "Plain mode"; ADR 0001: built first, always there). It is also the fallback:
when the 3D scene is off, fails or is killed, this screen takes its place within 2 s and the
class clock is unaffected (plan section 9). It shows a finished class in step with the music,
read from a bike up to about 12 m away, and nothing else.

## Content, in priority order

1. **Time left in the interval** (the countdown), and with beat anchors, the bars to the change.
2. **The zone**: number, name and colour, with its target ranges (%FTP, RPE; %HRmax when the
   class's zone scale has it) from `zone_scale` (ADR 0003).
3. **Cadence** (an RPM range, or "On the beat") and **position** (the word "Seated" or
   "Standing").
4. **The song's BPM.**
5. **The cue**, the designer's text for this interval, shown as written (rule 10).
6. **What comes next**: the next interval's zone (number, name, colour), length, cadence and
   position; or "End of class".
7. **The score**: the intervals and songs around now, moving under a fixed "now" line, with song
   titles, artists, BPM, phrase ticks every 4 bars and moments such as a drop.
8. **Time in the class**: left and done; the segment name (warm-up, main set, ...).
9. **The music-link state** (ADR 0001): quiet while following, a white plate otherwise.

All nine are visible at once in every running state at every size below. Nothing scrolls.

## Layout

All sizes are shares of the screen (vw, vh); the mock-ups use the same CSS at every size.
Safe area 5 % on every side.

### 16:9 and 16:10 (1920×1080, 1280×720, 1280×800; anything wider than 3:2)

```
+----------+--------------------------------------------------------+
| Zone     | 23:41 left  18:19 done            Main set  * Following |
|          | Interval left                       Cadence             |
|   4      |  1:10                               90-100 rpm          |
|          |                                     Position            |
|          |                                     Seated              |
|          | 37 bars to the change               Song  128 bpm       |
| Threshold| Find the beat and hold it.                              |
| 88-94%   | Breathe out on every second bar.                        |
|  FTP RPE | Next [2] Endurance 0:45 85-95 rpm Seated                 |
+----------+---------------------------------------------------------+
|//past////| 4 Threshold     | 2 Endurance | 5 VO2 max     | 3 Tempo  |  intervals
|//////////| Neon Avenue     | Pulse Theory Aurora Lane  132 bpm     |  songs
|          ^ now (25 % of the width)   | Drop                         |
+--------------------------------------------------------------------+
```

| Region | Box (left, top, width or right, height) | Content |
|---|---|---|
| Gel | 0, 0, 27 vw, 76 vh | Label "Zone", numeral (`--t-gel`), name (`--t-value`), targets (`--t-minor`) |
| Rail | 31 vw, 5 vh, to the right safe edge | Class time left and done, segment, link state |
| Clock | 31 vw, 11 vh, at most 62 vw − 40 vh wide | Label (and the FTP test tag), countdown (`--t-hero` or smaller, see "Fitting text"), bars line (`--t-minor`) |
| Metrics | 40 vh wide against the right safe edge, 12.5 vh | Cadence, position, BPM (`--t-value`, units `--t-minor`) |
| Cue | 31 vw, 54.5 vh, to the right safe edge, at most 3 lines | `--t-text`, or `--t-text-min` over 70 characters |
| Next | 31 vw, 73.5 vh | Label, zone chip, name, length, cadence, position (`--t-minor`) |
| Score | 0, 79.5 vh, full width, 15.5 vh | Intervals 6.6 vh, songs 8 vh; "now" at 25 vw; 6 minutes wide (1.5 behind, 4.5 ahead) |

16:10 (a common native projector resolution) uses this layout unchanged: the metrics column is
fixed in screen heights, so the clock simply gets less width and the countdown rule below sizes
it. Screenshots: [running at 1280×800](mockups/room-running-1280x800.png),
[FTP test at 1280×800](mockups/room-ftp-test-1280x800.png), and the narrowest ratio of this
layout, [FTP test at 1650×1080](mockups/room-ftp-test-1650x1080.png) (1.53 : 1).

### 4:3 and narrower (1440×1080, 1024×768)

```
+------------+-----------------------------------------+
| Zone       | 23:41 left  18:19 done   * Following    |
|   4        | Interval left                           |
|            |  1:10                                   |
| Threshold  | 37 bars to the change                   |
| 88-94% FTP | Cadence      Position     Song          |
| RPE 7-8    | 90-100 rpm   Seated       128 bpm       |
+------------+-----------------------------------------+
| Find the beat and hold it.                           |
| Breathe out on every second bar.                     |
| Next [2] Endurance 0:45 85-95 rpm Seated             |
+------------------------------------------------------+
| score, as at 16:9                                    |
+------------------------------------------------------+
```

The gel is 30 vw by 60 vh; the numeral 31 vh; the countdown at most 28 vh; a zone name that
needs two lines is set at 6.9 vh; the metrics sit in a row under the countdown; the cue (from
62 vh) and the next interval (78 vh) use the full width; the score is 83 to 95 vh; the segment
name is dropped from the rail. Switch point: any aspect ratio of 3:2 or narrower.

### Narrow presenter preview

The presenter window (on the instructor's own screen, not the room's) shows the room screen as a
live preview, drawn by the same code at the preview's size: 768×432 in a 1280×800 presenter
window ([presenter.html](mockups/presenter.html)), down to 480×270 on a small laptop. It is a
picture of what the room sees, read at arm's length, so the room-distance heights do not apply
to it; contrast, overlap and zone checks still do. Beside it the presenter shows what the room
does not need: the music link in detail with the measured and planned crossfade, the resync
notice with its undo (ADR 0001, timing model item 5), the next song change, the next three
intervals and the controls (pause, nudge, next song, manual clock). The presenter window's own
spec comes with PL5; this mock-up fixes only how the preview and the notice look.

## Fitting text

- **Countdown** (B1). Minutes and seconds, `M:SS` below 10 minutes and `MM:SS` from 10:00 to
  99:59 (FTP tests run 20 minutes; warm-ups often run longer than 10). An interval of 100
  minutes or more shows `99+` until 99:59 remain. The countdown is as large as `--t-hero` (36 vh)
  allows but never wider than the clock column, which ends 2 vw before the metrics column:
  font size = min(36 vh, (62 vw − 40 vh) ÷ w), where w is the widest string of the interval's
  format in em of Big Shoulders 800: 1.70 for `M:SS`, 2.11 for `MM:SS` and `99+` (measured:
  "0:00" 1.66 em, "88:88" 2.105 em). At 3:2 and narrower: min(28 vh, 61 vw ÷ w). The size is
  chosen at the interval change and stays fixed for the interval, so the countdown never
  changes size while it runs. `MM:SS` cap heights, measured: 1920×1080 27.0 %, 1280×800
  22.5 %, 1650×1080 21.1 %; computed for the narrowest ratio of the layout (just over 3:2):
  25.1 vh, 20.4 %, above the 20 % minimum. `M:SS` keeps the full 36 vh down to 16:10 (28.3 %
  at 1280×800). Mock-up: [FTP test](mockups/room-ftp-test.html).
- **Class time** in the rail: `MM:SS`, and `H:MM:SS` from one hour.
- **Bars line**: bars are counted while the change lies inside the playing song ("37 bars to the
  change"); when it lies further away, the line shows the time to the next song ("Next song in
  1:22"), as in the FTP test mock-up. No line when the clock is estimated or manual.
- **FTP test intervals** (`test` in ADR 0003): an outlined white tag "FTP test, 20 min" before
  the countdown's label. Outlined, not filled, so it is never mistaken for a link plate, and
  white, never a hue.
- **Zone name on the gel**: from the class, up to 80 characters. At most two lines at
  `--t-value` (at 4:3, a two-line name is set at 6.9 vh); a name that needs more than two lines
  steps down to `--t-minor` with at most three lines, and a longer one ends in an ellipsis after
  the third (the presenter shows it whole). Fixture: "Functional threshold" in the FTP test
  mock-up, two lines at every size.
- **Zone name in the "next" row**: never cut; the row drops the position first, then the
  cadence.
- **Time-in-zone list** (B2, before the start and finished): one row per zone the class uses,
  1 to 7, in two columns of up to four rows filled top to bottom (so 7 zones are 4 + 3). A row is
  the zone chip (colour and number), its planned time, and its name at `--t-label`. A name wraps
  to two lines; a longer one ends in an ellipsis after the second line, and the full name is on
  the gel when that zone plays. The list ends above 76 vh, clear of the score, at every layout;
  the first cue is not shown before the start (it appears with the first interval). Fixture:
  seven zones with "Endurance, the aerobic base for long steady rides" (49 characters, ends in an
  ellipsis), "Anaerobic capacity" and "Neuromuscular power".
- **Link plates** are at most about 20 characters ("Music not heard", "Not a class song", "Song
  is in twice", "Music paused"), so they fit beside the class time at 16:10 and 4:3; the detail
  ("estimated") is in the countdown's label, and the full story on the presenter.
- **Cue**: up to 120 characters. Up to 70 characters at `--t-text`, longer at `--t-text-min`;
  three lines hold 120 characters at every layout above. Never cut off, never scrolled.
- **Score blocks**: the zone number always; the name if and only if the whole name fits beside
  it, never cut (the mock-ups do this with a wrapping row that hides a name that does not fit).
  A block or clip that began in the past keeps its label just right of "now". Blocks wholly in
  the past are grey with no number: history, not information, and no zone colour without its
  number. Labels that would cross the safe edge are left out, not cut.
- **Song clips**: title first; the artist and then the BPM only when they fit whole inside the
  safe area. A moment's label (for example "Drop") sits on the clip's second line, so it never
  covers the title.
- **Other numbers** never shrink: the rest of the type scale is fixed per layout.

## States

Every state has a mock-up and a screenshot at 1920×1080; the key states also at 4:3 and 16:10.
Link states are white, grey and black only, never a hue (rule 7).

| State | When (ADR 0001) | What changes on the screen | Mock-up | Screenshot |
|---|---|---|---|---|
| Before the start | Class loaded, clock at 0 | Lights down on the first zone ("First zone"); class title, length, songs, intervals, class load; time in each zone (seven zones, long names); score with "now" at the start; link: "Waiting for the first song" (with the manual clock: "Press Start") | [html](mockups/room-before-start.html) | [16:9](mockups/room-before-start-1920x1080.png), [4:3](mockups/room-before-start-1440x1080.png) |
| Running, locked | A class song plays, readings fresh | The full layout; link "Following Spotify" in grey with a round dot | [html](mockups/room-running.html) | [1920](mockups/room-running-1920x1080.png), [1280×720](mockups/room-running-1280x720.png), [16:10](mockups/room-running-1280x800.png), [4:3](mockups/room-running-1440x1080.png), [preview](mockups/room-running-480x270.png) |
| Running, FTP test | A `test` interval, 18:42 left of 20:00 | Outlined tag "FTP test, 20 min"; five-glyph countdown sized by the rule above; "Next song in 1:22"; a two-line zone name | [html](mockups/room-ftp-test.html) | [1920](mockups/room-ftp-test-1920x1080.png), [1650×1080](mockups/room-ftp-test-1650x1080.png), [16:10](mockups/room-ftp-test-1280x800.png), [4:3](mockups/room-ftp-test-1440x1080.png) |
| Paused | The music app reports pause | Lights down: the gel goes dark and the zone colour moves into the numeral; a "Paused" plate above the frozen countdown; "Starts again with the music"; link plate "Music paused" | [html](mockups/room-paused.html) | [16:9](mockups/room-paused-1920x1080.png), [4:3](mockups/room-paused-1440x1080.png) |
| Coasting | Readings stopped or stale | Link plate "Music not heard"; label "Interval left, estimated"; the countdown itself dims to `--light-2` with a dashed rule under it, the same dash as the "now" line, which is dashed too; no bar count (a guess is not counted in bars) | [html](mockups/room-coasting.html) | [16:9](mockups/room-coasting-1920x1080.png) |
| Off the list | Something not in the class plays | Link plate "Not a class song"; "estimated"; the dimmed, dashed countdown; dashed "now"; BPM labelled "Song, planned"; no bar count | [html](mockups/room-off-list.html) | [16:9](mockups/room-off-list-1920x1080.png) |
| Ambiguous | The same recording is in the class twice | Link plate "Song is in twice"; the clip says "1st of 2"; the presenter offers the other | [html](mockups/room-ambiguous.html) | [16:9](mockups/room-ambiguous-1920x1080.png) |
| Manual clock | No link, or chosen | Link "Manual clock" in grey with a square marker (a choice, not a fault, so no plate); no bar count | [html](mockups/room-manual.html) | [16:9](mockups/room-manual-1920x1080.png) |
| Last interval | The class's final interval | Label "Last interval"; "bars to the end"; next row "End of class"; an "End" mark in the score | [html](mockups/room-last-interval.html) | [16:9](mockups/room-last-interval-1920x1080.png), [4:3](mockups/room-last-interval-1440x1080.png) |
| Finished | Class time reached the end | House lights up: a white gel, "Class Complete" and the length; title, time ridden, songs, class load (planned) and time in each zone; score at "End", the past in grey | [html](mockups/room-finished.html) | [16:9](mockups/room-finished-1920x1080.png), [4:3](mockups/room-finished-1440x1080.png) |

Within the states above:

- **Hold at a song change** (ADR 0001, items 2 and 6): the last interval under a song stays on
  screen with its cue; its label reads "Until the next song" and its countdown is the expected
  time to the next song. No other change.
- **A correction of more than 5 s** (ADR 0001, item 5) is announced on the presenter window and
  the companion, not on the room screen. The room screen simply shows the new place.
- **Swedebeat or a class with `song_timing: missing`**: the manual clock; no bar counts.
- **Last 5 seconds of an interval**: the label reads "Change in"; nothing flashes until the
  change itself.
- **Recovery from the 3D scene**: this screen appears in the state the clock is in; no
  start-up animation.

## Motion and reduced motion

The interval change is the one moment the screen moves on purpose: the gel's colour crosses in
700 ms and a white line runs down the gel's edge for 160 ms. The score moves continuously at
0.28 vw per second. A small dot beside the BPM marks the beat when the link is locked and the
song has beat anchors (otherwise it is not shown; it never claims to hit a beat it cannot
measure). With `prefers-reduced-motion` (and in the player's own reduced-motion setting, which
the plain screen honours the same way): colour changes are instant, there is no flash and no
beat dot, and the score steps once a second. No state relies on motion to be understood.

## What the screen never shows (plan section 3)

| Rule | How this screen keeps it |
|---|---|
| 1. Displays a finished class only | No editing, no reordering, no song choice on this screen or the presenter. The room screen has no controls at all |
| 2. Software only, never controls equipment | No control of resistance, incline, brake or speed anywhere; "Standing" and "Seated" are words for the rider |
| 3. Spotify's music stays in Spotify's app | The screen only names the song and shows the link state; nothing here plays, stores or downloads audio |
| 4. No road, ribbon, track, terrain or world | The score is a flat strip of equal-height blocks moving sideways like a music editor; no block has a height, slope or shape from an interval; no perspective, no horizon, nothing travelled along |
| 5. No viewpoint or rider moving through a scene | Nothing moves at a speed from data; no sensor data is shown in this version |
| 6. None of MOWL's look | No ring trio or ring of any kind, no row of class bars along the top, no grid of rider circles, no bar per rider against a target, no owl, flames, player or game names; our own palette (system.md) |
| 7. Colour means the planned zone | Hue only on things that stand for a planned zone; every state, plate and control is white, grey or black (check C6) |
| 8. No hand-position icons, no "adjust by your heart rate" | Position is a word; no hand icon; no heart-rate instruction |
| 9. Own names for load figures | "Class load" (from `totals.planned_load`); never TSS, Training Stress Score, Normalized Power or Intensity Factor |
| 10. Cues are designed text | The cue is shown as written in the class; no generated text, nothing spoken |
| 11. Nothing generated from past sessions | No suggestions, scores against earlier rides or automatic changes of intensity |
| 12. No camera | None |
| 13. Rider data one way | No rider data, list, ranking or comparison on the room screen |
| 14. Join code is a session id only | No join code on this screen in this version |
| 15. No team games | None |

## Measurable checks

These are what a Developer builds against and what CI checks on the real screen's screenshots
in PL4. [mockups/measure.js](mockups/measure.js) runs them on the mock-ups today
(`node docs/design/mockups/measure.js`, Playwright with Chromium, about fifteen minutes); every
check passes on every screenshot listed in [mockups/shots.js](mockups/shots.js).

| Check | Requirement |
|---|---|
| C1. Text height | Cap height as a share of the screen height, at every room size: countdown at least 20 %; gel numeral at least 25 %; values (zone name, cadence, position, BPM) at least 5.5 %; the cue, class time and the next interval at least 3 %; labels and score text at least 2 %. Not applied to the presenter window or the preview |
| C2. Contrast | WCAG 2 ratio between the text colour and the worst rendered background pixel inside the text's ink: at least 7 : 1 for everything except labels, at least 4.5 : 1 for labels |
| C3. Safe area | All text ink within 5 % of every edge |
| C4. No collisions | No two pieces of text overlap; no text is cut off by its container |
| C5. Zone | Every zone colour carries its number; the gel, the next row and the time-in-zone list also carry the name; a score block shows its name if and only if the whole name fits beside the number, and never draws it cut. Past score blocks carry no zone colour |
| C6. Hue | Any text, fill or border that is not grey lies inside an element that stands for a zone. Not covered by the mock-up script: hue inside `box-shadow` and gradients (the gel's glow is the zone's own colour); PL4 CI must cover them or forbid hue there |
| C7. Reduced motion | With reduced motion, no transition or animation lasts longer than 0 |
| C8. Coverage | Every piece of text on the screen is inside an element the checks see (in the mock-ups: a `data-tier` element), so no text escapes C1 to C4 |
| C9. Palette | From `tokens.css`, by [mockups/palette.js](mockups/palette.js): every zone at least 7 : 1 with black on it, on the stage and on the lights-down gel; neighbouring zones at least ΔE 30 apart for normal vision, 25 for protanopia and deuteranopia, 12 for tritanopia (system.md) |

What a check means for a room 12 m deep with a 3 m wide 16:9 image (1.69 m high): labels at
2.1 % are 36 mm capitals, the cue at 3.6 % is 61 mm, values at 6.8 % are 115 mm and the
countdown at 29 % is about 490 mm.
