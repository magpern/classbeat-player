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

All nine are visible at once in every running state at every size below, with two exceptions:

- the segment name (part of item 8) is dropped at 3:2 and narrower, and hidden while a link plate
  shows, because the rail then holds only the class time and the plate;
- at 3:2 and narrower, for an interval whose cue needs a fourth line (see "Cue" below), the next
  row (item 6) is shortened to the next zone's number, name and length; that interval's cadence
  and position are left out by choice, not because they would not fit: the row is shortened
  so that a four-line cue and the next row both stay clear of the score. The next zone's number
  and name are always on screen.

Nothing scrolls.

## Layout

All sizes are shares of the screen (vw, vh); the mock-ups use the same CSS at every size.
Safe area 5 % on every side.

**Supported room sizes**: any aspect ratio from 5:4 to 21:9 and at least 720 lines (1280×720
at 16:9, 1024×768 at 4:3). Every check below runs at ten sizes covering that range, with the
worst-case content of every text slot ([mockups/shots.js](mockups/shots.js)): 2560×1080 (21:9),
1920×1080, 1280×720 (the smallest), 1680×1050 and 1280×800 (16:10), 1650×1080 (1.53 : 1, the
narrowest ratio of the wide layout), 1620×1080 (3:2, the widest of the narrow layout),
1440×1080 and 1024×768 (4:3), 1280×1024 (5:4, the narrowest).

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
| Gel | 0, 0, 27 vw, 76 vh | Numeral (`--t-gel`) with the label "Zone" beside its top, name (`--t-value`, at most 5 vw), up to three targets (`--t-minor`, one per line) |
| Rail | 31 vw, 5 vh, to the right safe edge | Class time left and done, segment (hidden while a link plate shows), link state |
| Clock | 31 vw, 11 vh, at most 62 vw − 38 vh wide | Label (and the FTP test tag), countdown (`--t-hero` or smaller, see "Fitting text"), bars line (`--t-minor`) |
| Metrics | 38 vh wide against the right safe edge, 12.5 vh; values never wrap | Cadence, position, BPM (`--t-value`, units `--t-minor`) |
| Cue | 31 vw, 54.5 vh, to the right safe edge, ends by 73.3 vh | `--t-text` (at most 3 lines), or `--t-text-min` over 60 characters (at most 4 lines, line height 1.02) |
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

The gel is 30 vw by 60 vh; the numeral 31.5 vh; the countdown at most 28 vh; a zone name that
needs two lines is set at 7.1 vh (at most 5.75 vw); the metrics sit in a row under the countdown,
spread to the safe edge with at least 1.6 vw between them, values at min(7.55 vh, 5.7 vw) so
"On the beat", "Standing" and "Song, planned" fit on one line down to 5:4 (7.12 vh there, 7.55 vh
at 4:3). These two sizes are the **product's**: they are 3 % and 2.7 % above the nominal 6.9 vh
and min(7.4 vh, 5.55 vw) of the mock-ups, a margin because the product is measured in its own
browser (see C1), whose font metrics give cap heights about 2.3 % lower; the mock-ups keep the
nominal sizes, and both stay above the 5.5 % floor; the cue (from 62 vh, two lines at `--t-text`, three at `--t-text-min`) and the next
interval (78 vh) use the full width (a four-line cue moves the next row up beside the gel: see
"Cue" under "Fitting text"); the score is 83 to 95 vh; the segment name is dropped from
the rail. Switch point: any aspect ratio of 3:2 or narrower. 5:4 screenshot:
[last interval at 1280×1024](mockups/room-last-interval-1280x1024.png) ("On the beat") and the
worst cases below.

### Narrow presenter preview

The presenter window (on the instructor's own screen, not the room's) shows the room screen as a
live preview, drawn by the same code at the preview's size: 768×432 in a 1280×800 presenter
window ([presenter.html](mockups/presenter.html)), down to 480×270 on a small laptop. It is a
picture of what the room sees, read at arm's length, so the room-distance heights do not apply
to it; contrast, overlap and zone checks still do. Beside it the presenter shows what the room
does not need: the music link in detail with the measured and planned crossfade, the resync
notice with its undo (ADR 0001, timing model item 5), the next song change, the next three
intervals and the controls (pause, nudge, next song, manual clock). The presenter window's own
spec comes with PL5; this mock-up fixes only how the preview and the notice look, and
[presenter.md](presenter.md) sets the wording of its status, link and control lines.

## Fitting text

- **Countdown** (B1). Minutes and seconds, `M:SS` below 10 minutes and `MM:SS` from 10:00 to
  99:59 (FTP tests run 20 minutes; warm-ups often run longer than 10). An interval of 100
  minutes or more shows `99+` until 99:59 remain. The countdown is as large as `--t-hero` (36 vh)
  allows but never wider than the clock column, which ends 2 vw before the metrics column:
  font size = min(36 vh, (62 vw − 38 vh) ÷ w), where w is the widest string of the interval's
  format in em of Big Shoulders 800 with every digit in its cell (system.md, Type: a cell is
  as wide as the widest digit, "5", 0.480 em): 1.70 for `M:SS` (1.678 em), 2.16 for `MM:SS`
  and `99+` (2.158 em). At 3:2 and narrower: min(28 vh, 61 vw ÷ w). The size is chosen at the
  interval change and stays fixed for the interval, so the countdown never changes size while
  it runs. `MM:SS` cap heights, measured on "58:58": 2560×1080 29.2 %, 1920×1080 27.2 %,
  1280×800 22.8 %, 1650×1080 21.3 %, 4:3 22.7 %, 5:4 22.8 %; computed for the narrowest ratio
  of the layout (just over 3:2): 25.5 vh, 20.6 %, above the 20 % minimum. Mock-ups:
  [FTP test](mockups/room-ftp-test.html) and the worst cases.
- **Class time** in the rail: `MM:SS`, and `H:MM:SS` from one hour.
- **Bars line**: bars are counted while the change lies inside the playing song ("37 bars to the
  change"); when it lies further away, the line shows the time to the next song ("Next song in
  1:22"), as in the FTP test mock-up. No line when the clock is estimated or manual.
- **FTP test intervals** (`test` in ADR 0003): an outlined white tag "FTP test" before
  the countdown's label. Outlined, not filled, so it is never mistaken for a link plate, and
  white, never a hue.
- **Zone name on the gel**: from the class, up to 80 characters. At most two lines at
  `--t-value`, never larger than 5 vw (5.75 vw at 3:2 and narrower) so a word of up to 4 em fits
  the gel (at 3:2 and narrower, a two-line name is set at 7.1 vh). A name that needs more than two lines, or
  has a word too wide for the gel, steps down to `--t-minor` with at most three lines (two at
  3:2 and narrower), and a longer one ends in an ellipsis (the presenter shows it whole). At 3:2
  and narrower, a two-line name beside three targets is also set at `--t-minor`: the 60 vh gel
  holds the numeral, two lines of name and three targets only that way. The mock-ups choose by
  length (over 12 characters two lines, over 20 or a word over 11 characters the step-down); the
  product measures. Fixtures: "Functional threshold" (FTP test, worst paused), 80-character
  names (worst cases).
- **Targets on the gel**: up to three (%FTP, RPE, %HRmax), one per line where they do not fit
  side by side; never cut.
- **Zone name in the "next" row**: the chip, length, cadence and position always show; the name
  takes the rest of the row and ends in an ellipsis when it is longer (the whole name is on the
  gel when that zone plays).
- **Time-in-zone list** (B2, before the start and finished): one row per zone the class uses,
  1 to 7, in two columns of up to four rows filled top to bottom (so 7 zones are 4 + 3). A row is
  the zone chip (colour and number), its planned time (a column 10.5 vh wide, so that a zone of an
  hour or more, such as `1:27:38`, stays on one line; 9 vh is not enough), and its name at `--t-label`. A name wraps
  to two lines; a longer one ends in an ellipsis after the second line, and the full name is on
  the gel when that zone plays. The list ends above 76 vh, clear of the score, at every layout;
  the first cue is not shown before the start (it appears with the first interval). Fixture:
  seven zones with "Endurance, the aerobic base for long steady rides" (49 characters, ends in an
  ellipsis), "Anaerobic capacity" and "Neuromuscular power".
- **Link plates** are at most about 20 characters ("Music not heard", "Not a class song", "Song
  is in twice", "Music paused"), so they fit beside the class time at 16:10 and 4:3; the detail
  ("estimated") is in the countdown's label, and the full story on the presenter.
- **Cue**: up to 120 characters, never cut off, never scrolled. Up to 60 characters at
  `--t-text`, longer at `--t-text-min`. In the wide layout the cue box holds three lines at
  `--t-text` or four at `--t-text-min` (line height 1.02): a 120-character cue with long words
  needs the fourth line near 3:2. At 3:2 and narrower it is full width: two lines at `--t-text`,
  three at `--t-text-min`. A word longer than a line breaks rather than being cut. A cue that
  still needs a fourth line there (only wide capitals near 120 characters, as in the
  [wide-glyph worst case at 5:4](mockups/room-worst-wide-1280x1024.png)) takes the next row's
  place for that interval: four lines at `--t-text-min`, line height 1.02, from 62.8 vh. The next
  row moves up beside the foot of the gel (34 vw, 56.5 vh) and is shortened to "Next", the zone
  chip, the name (ellipsis as usual) and the length; cadence and position are left out. To make
  that room the gaps around the countdown close up (clock from 10.5 vh, 0.4 vh above the
  countdown, 0.6 vh above the bars, metrics from 44.4 vh); no size changes. The product measures
  whether three lines hold the cue; the wide-glyph fixture does the same, so at 3:2 and 4:3 it
  shows three lines and the
  [full next row](mockups/room-worst-wide-1440x1080.png).
- **Score blocks**: the zone number always; the name if and only if the whole name fits beside
  it, never cut (the mock-ups do this with a wrapping row that hides a name that does not fit).
  A block or clip that began in the past keeps its label just right of "now". Blocks wholly in
  the past are grey with no number: history, not information, and no zone colour without its
  number. A block with **under 3 vw ahead of "now"** (a block that began in the past counts from
  "now") cannot hold its number whole: it is drawn as a **neutral sliver**, the same grey as
  history, with no zone colour, no number and no label. A block that begins right of 91 vw has no
  room for its number inside the safe area and is not drawn (the next row names the next zone).
  Labels that would cross the safe edge are left out, not cut.
- **Song clips**: title first, ending in an ellipsis when it is longer than the clip; the artist
  and then the BPM only when they fit whole inside the safe area (checked both ways, like the
  score blocks). A moment's label (for example "Drop") sits on the clip's second line, so it never
  covers the title. In the ambiguous state the occurrence marker ("1st of 2") is its own label
  right after the title and is never cut: the title gives up width to its ellipsis first
  ([worst case](mockups/room-worst-ambiguous.html), [1650×1080](mockups/room-worst-ambiguous-1650x1080.png)).
- **Class title** (before the start and finished): up to 80 characters. One line at 11 vh (9 vh
  at 3:2 and narrower); a title that does not fit steps down to `--t-value` on one line (two
  lines at 7.4 vh at 3:2 and narrower), then ends in an ellipsis (the presenter shows it whole).
  The time-in-zone list below it must still end above the score with seven zones of two-line
  names.
- **Segment name** in the rail: takes the space left and ends in an ellipsis. Hidden while a link
  plate shows; dropped at 3:2 and narrower.
- **Beat dot**: after the BPM unit, 0.22 em wide with a 0.18 em gap, part of the value's width (the
  metric row and column are sized with it; it is drawn in the text colour, so the checks count it
  as part of the value).
- **Metric values** (cadence, position, BPM) never wrap: see the column and row sizes above.
- **Other numbers** never shrink: the rest of the type scale is fixed per layout.

**Worst cases.** Eight fixtures put the longest or widest content the format allows in every
slot and are checked at all ten sizes. Three were added for the #31 review: the
[ambiguous state](mockups/room-worst-ambiguous.html) with 80-character song titles and the
occurrence marker, and two **width-based** fixtures, [running](mockups/room-worst-wide.html) and
[before the start](mockups/room-worst-wide-before-start.html), with names, segment and titles made
of the widest capitals (M, W) and single 80-character words, and a 120-character cue in wide
capitals ([1650×1080](mockups/room-worst-wide-1650x1080.png), [4:3](mockups/room-worst-wide-1440x1080.png)
with three cue lines and the full next row, [5:4](mockups/room-worst-wide-1280x1024.png) with
four cue lines and the short next row, [before the start](mockups/room-worst-wide-before-start-1650x1080.png)). The mock-ups choose
step-downs by character count; the width-based fixtures are the ones the product's own measuring
must pass, and PL4 CI keeps them. The other five: [off the list](mockups/room-worst-off-list.html) (tag and "Interval
left, estimated", plate "Not a class song", `58:58`, class time `1:58:58`, "On the beat",
"Standing", "Song, planned", BPM 200, a 120-character cue with long words, 80-character zone,
segment and song names, three targets, "Breakdown"), [running](mockups/room-worst-running.html)
(an 80-character segment name beside "Following Spotify", "288 bars to the change", an RPM
range, a 60-character cue at `--t-text`), [paused](mockups/room-worst-paused.html) (the pill and
"Starts again with the music", a two-line zone name beside three targets),
[before the start](mockups/room-worst-before-start.html) and
[finished](mockups/room-worst-finished.html) (an 80-character title, seven zones with 80-character
names, `2:12:00`). Screenshots: off the list at
[5:4](mockups/room-worst-off-list-1280x1024.png) and [1650×1080](mockups/room-worst-off-list-1650x1080.png),
running at [1280×720](mockups/room-worst-running-1280x720.png), before the start at
[5:4](mockups/room-worst-before-start-1280x1024.png) and [1650×1080](mockups/room-worst-before-start-1650x1080.png).

## States

Every state has a mock-up and a screenshot at 1920×1080; the key states also at 4:3 and 16:10.
Link states are white, grey and black only, never a hue (rule 7).

| State | When (ADR 0001) | What changes on the screen | Mock-up | Screenshot |
|---|---|---|---|---|
| Before the start | Class loaded, clock at 0 | Lights down on the first zone ("First zone"); class title, length, songs, intervals, class load; time in each zone (seven zones, long names); score with "now" at the start; link: "Waiting for the first song" (with the manual clock: "Press Start") | [html](mockups/room-before-start.html) | [16:9](mockups/room-before-start-1920x1080.png), [4:3](mockups/room-before-start-1440x1080.png) |
| Running, locked | A class song plays, readings fresh | The full layout; link "Following Spotify" in grey with a round dot; the beat dot after the BPM ([reduced motion](mockups/room-running-reduced-1920x1080.png): no dot) | [html](mockups/room-running.html) | [1920](mockups/room-running-1920x1080.png), [1280×720](mockups/room-running-1280x720.png), [16:10](mockups/room-running-1280x800.png), [4:3](mockups/room-running-1440x1080.png), [preview](mockups/room-running-480x270.png) |
| Running, FTP test | A `test` interval, 18:42 left of 20:00 | Outlined tag "FTP test"; five-glyph countdown sized by the rule above; "Next song in 1:22"; a two-line zone name | [html](mockups/room-ftp-test.html) | [1920](mockups/room-ftp-test-1920x1080.png), [1650×1080](mockups/room-ftp-test-1650x1080.png), [16:10](mockups/room-ftp-test-1280x800.png), [4:3](mockups/room-ftp-test-1440x1080.png) |
| Paused | The music app reports pause | Lights down: the gel goes dark and the zone colour moves into the numeral; a "Paused" plate above the frozen countdown; "Starts again with the music"; link plate "Music paused" | [html](mockups/room-paused.html) | [16:9](mockups/room-paused-1920x1080.png), [4:3](mockups/room-paused-1440x1080.png) |
| Coasting | Readings stopped or stale | Link plate "Music not heard"; label "Interval left, estimated"; the countdown itself dims to `--light-2` with a dashed rule under it, the same dash as the "now" line, which is dashed too; no bar count (a guess is not counted in bars) | [html](mockups/room-coasting.html) | [16:9](mockups/room-coasting-1920x1080.png) |
| Off the list | Something not in the class plays | Link plate "Not a class song"; "estimated"; the dimmed, dashed countdown; dashed "now"; BPM labelled "Song, planned"; no bar count | [html](mockups/room-off-list.html) | [16:9](mockups/room-off-list-1920x1080.png) |
| Ambiguous | The same recording is in the class twice | Link plate "Song is in twice"; the clip carries the marker "1st of 2", never cut; the presenter offers the other | [html](mockups/room-ambiguous.html) | [16:9](mockups/room-ambiguous-1920x1080.png) |
| Manual clock | No link, or chosen | Link "Manual clock" in grey with a square marker (a choice, not a fault, so no plate); no bar count | [html](mockups/room-manual.html) | [16:9](mockups/room-manual-1920x1080.png) |
| Last interval | The class's final interval | Label "Last interval"; "bars to the end"; next row "End of class"; an "End" mark in the score | [html](mockups/room-last-interval.html) | [16:9](mockups/room-last-interval-1920x1080.png), [4:3](mockups/room-last-interval-1440x1080.png) |
| Finished | Class time reached the end | House lights up: a white gel, "Class Complete" and the length; title, time ridden, songs, class load (planned) and time in each zone; score at "End", the past in grey | [html](mockups/room-finished.html) | [16:9](mockups/room-finished-1920x1080.png), [4:3](mockups/room-finished-1440x1080.png) |
| Interval of 100 minutes or more | More than 99:59 left | The countdown reads `99+` (sized as `MM:SS`) until 99:59 remain | [html](mockups/room-long-interval.html) | [16:9](mockups/room-long-interval-1920x1080.png) |
| Last 5 seconds | 5 s or less to the change | Label "Change in"; nothing flashes until the change itself | [html](mockups/room-change-in.html) | [16:9](mockups/room-change-in-1920x1080.png) |
| Hold at a song change | See below | Label "Until the next song"; the countdown is the expected time to the next song; no bar count | [html](mockups/room-hold.html) | [16:9](mockups/room-hold-1920x1080.png) |
| Before the start, manual clock | Class loaded, no music link | As before the start, with "Press Start" in grey with a square marker (a choice, not a fault) | [html](mockups/room-before-start-manual.html) | [16:9](mockups/room-before-start-manual-1920x1080.png) |

These four are also checked at 1650×1080 and 5:4, the narrowest ratio of each layout.

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
0.28 vw per second. A small dot after the BPM marks the beat when the link is locked and the
song has beat anchors (otherwise it is not shown; it never claims to hit a beat it cannot
measure). It follows the beats it marks: the tempo between the song's beat anchors where the
song is playing, not the song's listed BPM. Two lights always start at least 1/3 s apart; a beat
that comes sooner after the last light is skipped. In steady time that is every beat up to
180 BPM and every second beat above (200 BPM: 1.67 lights a second), and tempo drift near 180
can never give four lights in one second. With `prefers-reduced-motion` (and in the player's own reduced-motion setting, which
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
in PL4, at every supported size with the worst-case content. On the mock-ups,
[mockups/shoot.js](mockups/shoot.js) takes the screenshots and then runs
[mockups/measure.js](mockups/measure.js) on every shot in [mockups/shots.js](mockups/shots.js)
(the states, four more states at three sizes, and the eight worst cases at all ten sizes, and the presenter at two: 118
shots, about twelve minutes with Playwright and Chromium, animations stopped at their first
frame so every PNG reproduces); it exits non-zero on any failure and ends with a summary table of
fixture by size. Every check passes on every shot.

| Check | Requirement |
|---|---|
| C1. Text height | **Measured in the product's own browser** on the real screen (the CI Chromium), not on the mock-ups: its font metrics give cap heights about 2.3 % lower than the mock-up browser, which is why the product's value sizes carry the margin given under "Layout". The floors below are not lowered. Cap height as a share of the screen height, at every room size: countdown at least 20 %; gel numeral at least 25 %; values (zone name, cadence, position, BPM) at least 5.5 % (a zone name stepped down by the fitting rules: 3 %); the cue, class time and the next interval at least 3 %; labels and score text at least 2 %. Not applied to the presenter window or the preview |
| C2. Contrast | WCAG 2 ratio between the text colour and the worst rendered background pixel inside the text's ink: at least 7 : 1 for everything except labels, at least 4.5 : 1 for labels |
| C3. Safe area | All text ink within 5 % of every edge |
| C4. No collisions | No two pieces of text overlap; no text is covered by a fill (the score over a list); no text wraps to more lines than its slot allows (one unless the spec says more); no text is cut off by its own box or a container, except a designed ellipsis and the score labels shown only when they fit whole; the ink of the next row ends at least 5 px above the top of the score at every size (a minimum: no design may go below it) |
| C5. Zone | Every zone colour carries its number; the gel, the next row and the time-in-zone list also carry the name; a score block shows its name if and only if the whole name fits beside the number, and never draws it cut. Past score blocks carry no zone colour |
| C6. Hue | Any text, fill or border that is not grey lies inside an element that stands for a zone. Not covered by the mock-up script: hue inside `box-shadow` and gradients (the gel's glow is the zone's own colour); PL4 CI must cover them or forbid hue there |
| C7. Motion | With reduced motion, no transition or animation lasts longer than 0; without it, nothing that repeats (the beat dot) cycles more than three times a second. The mock-ups can only check CSS animations and transitions: PL4 CI must also cover the beat dot's real timing (at least 1/3 s between the starts of two lights, including with tempo drift near 180 BPM), the 160 ms edge flash and the score's movement (continuous, and whole-second steps with reduced motion) |
| C8. Coverage | Every piece of text on the screen is inside an element the checks see (in the mock-ups: a `data-tier` element), so no text escapes C1 to C4 |
| C9. Palette | From `tokens.css`, by [mockups/palette.js](mockups/palette.js): every zone at least 7 : 1 with black on it, on the stage and on the lights-down gel; neighbouring zones at least ΔE 30 apart for normal vision, 25 for protanopia and deuteranopia, 12 for tritanopia (system.md) |

How the mock-up script finds ink ([mockups/ink.js](mockups/ink.js)): a pixel is ink when it differs
from the picture without text by more than 90 (sum of the RGB differences), and lone pixels are
dropped (Chromium repaints anti-aliased corners near the text slightly differently). This trims a
light-on-dark ink box by about a pixel at its edges, which C1 to C4 tolerate on the mock-ups; the
PL4 CI check states its own threshold.

What a check means for a room 12 m deep with a 3 m wide 16:9 image (1.69 m high): labels at
2.1 % are 36 mm capitals, the cue at 3.6 % is 61 mm, values at 6.8 % are 115 mm and the
countdown at 29 % is about 490 mm.
