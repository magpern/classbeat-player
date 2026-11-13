# Screen spec: the plain 2D room screen

Status: proposed in the pull request for issue #22; the controls on the room screen and the class
code were added for the owner's "one screen first" (plan section 3, 2026-11-13). Design system:
[system.md](system.md). Reference mock-ups and screenshots: [mockups/](mockups/).

## Purpose

The screen the riders see on the projector or TV, and the first screen the product runs on
(plan section 3, "Plain mode"; ADR 0001: built first, always there). It is also the fallback:
when the 3D scene is off, fails or is killed, this screen takes its place within 2 s and the
class clock is unaffected (plan section 9). It shows a finished class in step with the music,
read from a bike up to about 12 m away, and nothing else.

**One screen first** (plan section 3). The usual studio has one screen, and this screen alone runs
a class: it carries its own controls (Start, Pause and Resume, Previous, Next, End) and, when a
phone remote is on, the class code. They live in one band that appears when the mouse moves and
fades out after a few idle seconds; while it is hidden the screen is exactly the one specified
below. See "Controls on the room screen". The presenter window is an option for a second display
([presenter.md](presenter.md)), never needed to run a class.

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

The control band and the class code (see "Controls on the room screen") are not part of this
list: they show only while the instructor uses them, and only over the score.

## Layout

All sizes are shares of the screen (vw, vh); the mock-ups use the same CSS at every size.
Safe area 5 % on every side.

**Supported room sizes**: any aspect ratio from 5:4 to 21:9 and at least 720 lines (1280×720
at 16:9, 1024×768 at 4:3). Every check below runs at ten sizes covering that range, with the
worst-case content of every text slot ([mockups/shots.js](mockups/shots.js)): 2560×1080 (21:9),
1920×1080, 1280×720 (the smallest), 1680×1050 and 1280×800 (16:10), 1650×1080 (1.53 : 1, the
narrowest ratio of the wide layout), 1620×1080 (3:2, the widest of the narrow layout),
1440×1080 and 1024×768 (4:3), 1280×1024 (5:4, the narrowest).
With one display the room window fills that display (class-list.md, "Where the room window
goes"), so every check here applies to it as to a projector. Only a window the instructor shrinks
by hand is a rehearsal view, not held to C1.

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
at 4:3). These two sizes are the **product's**: the first is 3 % above the mock-ups' nominal 6.9 vh,
and the second is 2 % (its vh term) and 2.7 % (its vw term) above their min(7.4 vh, 5.55 vw), a
margin because the product is measured in its own
browser (see C1), whose font metrics give cap heights about 2.3 % lower; the mock-ups keep the
nominal sizes, and both stay above the 5.5 % floor; the cue (from 60 vh, two lines at
`--t-text`, three at `--t-text-min`) and the next interval (76 vh) use the full width (a four-line
cue moves the next row up beside the gel: see
"Cue" under "Fitting text"); the score is 83 to 95 vh; the segment name is dropped from
the rail. Switch point: any aspect ratio of 3:2 or narrower. 5:4 screenshot:
[last interval at 1280×1024](mockups/room-last-interval-1280x1024.png) ("On the beat") and the
worst cases below.

### With a second display: the presenter's preview

This applies only when a second display is connected and the instructor uses the presenter
window there (an option, plan section 3; the room screen needs nothing from it). The presenter
window shows the room screen as a
live preview, drawn by the same code at the preview's size: 768×432 in a 1280×800 presenter
window ([presenter.html](mockups/presenter.html)), down to 480×270 on a small laptop. It is a
picture of what the room sees, read at arm's length, so the room-distance heights do not apply
to it; contrast, overlap and zone checks still do. Beside it the presenter shows what the room
does not need: the music link in detail with the measured and planned crossfade, the resync
notice with its undo (ADR 0001, timing model item 5), the next song change, the next three
intervals and the controls (pause, nudge, next song, manual clock), a superset of the room
screen's own five (see "Controls on the room screen"). The preview shows the room screen without
its control band. The presenter window's own
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
  the gel (at 3:2 and narrower, a two-line name is set at 7.1 vh). A name that needs more than two
  lines, or
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
  hour or more, such as `1:27:38`, stays on one line; 9 vh is not enough), and its name at
  `--t-label`. At 3:2 and narrower the list starts 2.5 vw further left (still 1.5 vw clear of the
  gel), the chip column is 4.4 vh, the time column 10.3 vh, and the gaps are 0.7 vw inside a row
  and 1.2 vw between the columns, so that a zone-name word of up to 16 letters stays whole in its
  column (CI checks it). A name wraps to two lines; a longer one ends in an ellipsis after the
  second line, and the full name is on
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
  history, with no zone colour, no number and no label. A block that begins right of 91 vw
  (`NUMBER_FITS_UNTIL` in `web/src/room/score.ts`; the sliver rule is applied first) has no
  room for its number inside the safe area and is not drawn (the next row names the next zone).
  Labels that would cross the safe edge are left out, not cut.
- **Song clips**: title first, ending in an ellipsis when it is longer than the clip; the artist
  and then the BPM only when they fit whole inside the safe area (checked both ways, like the
  score blocks). A moment's label (for example "Drop") sits on the clip's second line, so it never
  covers the title. In the ambiguous state the occurrence marker ("1st of 2") is its own label
  right after the title and is never cut: the title gives up width to its ellipsis first
  ([worst case](mockups/room-worst-ambiguous.html),
  [1650×1080](mockups/room-worst-ambiguous-1650x1080.png)).
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
capitals ([1650×1080](mockups/room-worst-wide-1650x1080.png),
[4:3](mockups/room-worst-wide-1440x1080.png)
with three cue lines and the full next row, [5:4](mockups/room-worst-wide-1280x1024.png) with
four cue lines and the short next row, [before the
start](mockups/room-worst-wide-before-start-1650x1080.png)). The mock-ups choose
step-downs by character count; the width-based fixtures are the ones the product's own measuring
must pass, and PL4 CI keeps them. The other five: [off the list](mockups/room-worst-off-list.html)
(tag and "Interval
left, estimated", plate "Not a class song", `58:58`, class time `1:58:58`, "On the beat",
"Standing", "Song, planned", BPM 200, a 120-character cue with long words, 80-character zone,
segment and song names, three targets, "Breakdown"), [running](mockups/room-worst-running.html)
(an 80-character segment name beside "Following Spotify", "288 bars to the change", an RPM
range, a 60-character cue at `--t-text`), [paused](mockups/room-worst-paused.html) (the pill and
"Starts again with the music", a two-line zone name beside three targets),
[before the start](mockups/room-worst-before-start.html) and
[finished](mockups/room-worst-finished.html) (an 80-character title, seven zones with 80-character
names, `2:12:00`). Screenshots: off the list at
[5:4](mockups/room-worst-off-list-1280x1024.png) and
[1650×1080](mockups/room-worst-off-list-1650x1080.png),
running at [1280×720](mockups/room-worst-running-1280x720.png), before the start at
[5:4](mockups/room-worst-before-start-1280x1024.png) and
[1650×1080](mockups/room-worst-before-start-1650x1080.png).

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
| Manual clock | No link, or chosen | Link "Manual clock" in grey with a square marker (a choice, not a fault, so no plate); no bar count. Where the music could be followed, "Manual · F to follow", and "Following stopped" in white for 30 s after a hand-over ("Back to following the music") | [html](mockups/room-manual.html) | [16:9](mockups/room-manual-1920x1080.png) |
| Last interval | The class's final interval | Label "Last interval"; "bars to the end"; next row "End of class"; an "End" mark in the score | [html](mockups/room-last-interval.html) | [16:9](mockups/room-last-interval-1920x1080.png), [4:3](mockups/room-last-interval-1440x1080.png) |
| Finished | Class time reached the end | House lights up: a white gel, "Class Complete" and the length; title, time ridden, songs, class load (planned) and time in each zone; score at "End", the past in grey. The room window stays on this state until the instructor leaves the class (class-list.md, "When the room window closes, and how it comes back") | [html](mockups/room-finished.html) | [16:9](mockups/room-finished-1920x1080.png), [4:3](mockups/room-finished-1440x1080.png) |
| Interval of 100 minutes or more | More than 99:59 left | The countdown reads `99+` (sized as `MM:SS`) until 99:59 remain | [html](mockups/room-long-interval.html) | [16:9](mockups/room-long-interval-1920x1080.png) |
| Last 5 seconds | 5 s or less to the change | Label "Change in"; nothing flashes until the change itself | [html](mockups/room-change-in.html) | [16:9](mockups/room-change-in-1920x1080.png) |
| Hold at a song change | See below | Label "Until the next song"; the countdown is the expected time to the next song; no bar count | [html](mockups/room-hold.html) | [16:9](mockups/room-hold-1920x1080.png) |
| Before the start, manual clock | Class loaded, no music link | As before the start, with "Press Start" in grey with a square marker (a choice, not a fault). The Start it names is the band's own Start button just below (shown before the start with one display), Space, or the presenter's Start with a second display | [html](mockups/room-before-start-manual.html) | [16:9](mockups/room-before-start-manual-1920x1080.png) |

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
can never give four lights in one second. With `prefers-reduced-motion` (and in the player's own
reduced-motion setting, which
the plain screen honours the same way): colour changes are instant, there is no flash and no
beat dot, and the score steps once a second. No state relies on motion to be understood.

## Controls on the room screen (one screen first)

Plan section 3, "One screen first" (owner, 2026-11-13): the class runs on one screen with its
controls on it. They appear when the mouse moves, fade out after a few idle seconds and never
cover what riders read while hidden; the keyboard works with them hidden.

### What is on it

One **control band**, in priority order:

1. **Start / Pause / Resume**: one button, the main one (white outline). Its word is the clock's
   state, never the press: "Start" before the start, "Pause" while running or holding at a song
   change, "Resume" while paused. It changes when the clock (or the music app) reports the new
   state, not when it is pressed, so it never shows a state the player is not in.
2. **Previous** and **Next**, either side of it.
3. **End**, at the right end of the band, apart from the others.
4. **The class code**, between Next and End, only while a phone remote is on (see "The class code").

Nothing else. The class code slot's **Phone remote** button (state Off, below) is part of item 4,
not a sixth control. Back 5 s and Forward 5 s, Follow the music, Manual clock, Undo, picking an
occurrence of a repeated song and the phone remote's own settings are **not** on the band: they
stay on the keyboard (below) and on the presenter window when there is a second display
(presenter.md). The owner named these five as the useful ones; the rest are rare or for a
rehearsal. The way back to following the music with one screen is a key named in the rail
("Back to following the music", below), not a band control.

### What a press does: the same routing as the presenter

The band adds no clock or music behaviour: each button sends the presenter's existing command
(`ClockCommand` in `player/app/src/core/commands.ts`) through the same routing
(`routeWhileFollowing` in `core/link/while-following.ts`, ADR 0001: "start, pause and next go
through the same local interface"). Its second line says where the press goes, from the same
route (`controlLabels` does this for Next and Previous today; the other buttons use the same
route):

| Button | Command | Following the music (locked, in a following state) and the music app can be sent commands | Following, but the music app cannot be sent commands (`canSend` false) | Manual clock; following before the first lock; or the music not heard or off the list (the clock is the instructor's own then) |
|---|---|---|---|---|
| Start | `start` | Asks the music app to play; the clock follows it | The clock starts and the link goes to the manual clock: "Stops following" | The clock starts. Before the first lock it also asks the music app to play (when it can be sent), and the first lock takes over |
| Pause, Resume | `pause`, `resume` | Sent to the music app; the clock follows its answer (room screen "Paused" when the music app reports pause) | The clock pauses or resumes and the link goes to the manual clock: second line "Stops following" | The clock pauses or resumes |
| Next | `next` | **Next song**: the music app skips to the next track and the clock follows it there. Second line "Song" | The clock goes to the next interval and the link goes manual: "Stops following" | **Next interval**: the start of the next interval. Second line "Interval" |
| Previous | `previous` | Always on the clock, so it hands over: "Stops following" | The same: "Stops following" | **Previous interval**: back to the start of this interval, or to the start of the one before when this one began less than 3 s ago (`PREVIOUS_RESTART_MS`, as a music player's "previous" does). Second line "Interval" |
| Previous, Next before the start and before the first lock | `previous`, `next` | Not following yet, so the right-hand column applies. (The link can lock before the start: `firstLock` in `core/link/follower.ts` locks a ready clock. Once locked, the first two columns apply as for any following state, from the same route) | | On the clock, which stays at rest (`moveTo` keeps a ready clock ready): Next moves the start point to the next interval's start, Previous back to the start of the current one, or of the one before when this one began less than 3 s ago. Nothing is sent to the music app. Second line "Interval" |
| End | none (it leaves the class) | See "End" | | |

Previous and Next therefore step over **intervals** on the clock, and Next steps over **songs**
only when the music app is asked (the clock then lands on that song's place). A press that hands
the clock over is never silent: its button says "Stops following" before the press, and the rail
then shows "Manual clock" with the square marker. Where the presenter says "(stops following)" in
brackets after the label, the band puts the same words on the second line.

### What the room window needs from the desktop shell

Today the room window only **receives**: the desktop shell's bridge gives it one channel, the
room state (`ROOM_CHANNELS = [CH_ROOM_STATE]` in `player/app/src/core/ipc-policy.ts`), and it
sends nothing. The band needs the bridge to grow:

- room window to the shell: the band's `ClockCommand`s (start, pause, resume, next, previous) and
  the keyboard's (jump, undo, follow; below); start and stop the phone remote; end (close) the
  class;
- shell to the room window: the class code slot's state and the **join code**, nothing else of
  the live session.

That is **its own security-critical issue** (the desktop shell's bridge, AGENTS.md section 5),
built and merged before the band. The shell checks every message from the room window against a
fixed list of commands, as it does the presenter's. ADR 0005's guard ("the control code is sent
only on the presenter's channel, never on the room window's") must cover **every new room
channel**: no control code, token or controller detail on any of them, checked by a test. This
spec does not name the channels; the issue does.

### Back to following the music

A press that hands the clock over (Previous, a nudge, or any press the music app cannot be sent)
leaves the clock manual until the instructor follows the music again. With a second display that
is the presenter's "Follow the music". With one screen it is the **F key**, and the rail says so
with the band hidden, in the link state's place (no sixth band control):

| When | The rail's link state | Mock-up |
|---|---|---|
| The 30 s after a hand-over (the announcement of ADR 0001, `undoWindowMs`) | "Following stopped", **white**, with the manual clock's square marker: news, not a fault, so no plate | [html](mockups/room-handover.html), [16:9](mockups/room-handover-1920x1080.png); worst case [5:4](mockups/room-worst-handover-1280x1024.png) |
| After that, while the clock is manual and the music could be followed (the link view's `available` flag, the same one that hides the presenter's "Follow the music" in `renderer/presenter.ts`: a music app the player can hear and a class with song timing) | "Manual · F to follow", grey, square marker | [html](mockups/room-manual-follow.html), [16:9](mockups/room-manual-follow-1920x1080.png); worst case [4:3](mockups/room-worst-manual-follow-1024x768.png), [5:4](mockups/room-worst-manual-follow-1280x1024.png) |
| Manual with no music link (no reader on this computer, Swedebeat, `song_timing: missing`) | "Manual clock", as today: no key, since F could do nothing | [html](mockups/room-manual.html) |

**F** sends `follow` (the presenter's "Follow the music"): the next fresh reading puts the clock
where the music is, as ADR 0001's relink does. It works at any time the music could be followed,
including during the 30 s notice, with the band shown or hidden, and does not show the band.
Where the music cannot be followed it does nothing. Both lines fit the rail beside `H:MM:SS`
class times at every size (the worst cases are checked at all ten); a longer line ("Following
stopped · F to follow") does not fit at 4:3 and 5:4, which is why the key is named only after the
notice.

### When it shows and when it hides

- **Shows** on a pointer move of at least 6 px over the room window (a nudged table is not a
  move), on a tap on a touch screen, on Tab, and on the End key. A key that does something else
  (Space, the arrows, F) works without showing it: its effect is on the screen already (the
  "Paused" plate, the new interval, the rail's link state).
- **Hides 3 s after the last input of any kind**: a pointer move, a click, a tap or a key press
  each restart the 3 s. Only two things hold it: **keyboard focus reached by Tab** (or Shift+Tab)
  inside the band, and the **End question** while it is open. A pointer resting over the band
  does not hold it, and a click does not leave it held: a button pressed with the pointer or by a
  tap does its job and the band hides 3 s later (a pointer press never counts as keyboard focus;
  the shell drops the focus from a button pressed that way). Esc hides it at once and drops the
  focus. The pointer is hidden with it.
- **The fade.** Buttons take presses from the first frame the band starts to appear. From the
  first frame of the fade-out (300 ms, or at once with reduced motion) the band counts as hidden:
  it takes no presses, and a click or tap then only shows it again (next item).
- **With one display it does not hide before the start, nor on "Class Complete"**: Start (or
  Close class) is always in sight there, which is what the owner missed on the first Mac run.
  With a second display it hides before the start too (the presenter has Start).
- **A click or tap while it is hidden presses nothing.** The first one only shows the band, so a
  click on the screen can never pause or end a class by accident.
- **Touch** (a touch screen or a projector's touch layer): there is no hover and no pointer
  move, so a tap is the only way in. A tap while hidden shows the band and presses nothing; a tap
  on a button while shown presses it; a tap elsewhere while shown restarts the 3 s. No swipe,
  long press or double tap does anything. The buttons (at least 9.4 vh, 72 px at 768 lines) are
  large enough for a finger at every size.
- It never takes the keyboard focus by itself; Tab moves into it.

### What it covers

The band is the **score's box exactly** (16:9 and wider down to 3:2: 0, 79.5 vh, full width,
15.5 vh; 3:2 and narrower: 0, 83 vh, full width, 12 vh) and is opaque (`--stage`, a 0.3 vh
`--stage-line` rule along its top). While shown it covers the score and nothing else: the gel
(zone number, name, targets), the rail (class time, segment, link state), the countdown and bar
count, the metrics, the cue and the next row stay where they are, uncovered and unchanged. The
score keeps moving underneath and is back, in its right place, when the band hides. The
next row's 0.7 vh clearance above the score (C4) is therefore also its clearance above the band.
While hidden, the band covers nothing: the screen is pixel for pixel the state without it.

### Layout of the band

```
+------------------------------------------------------------------------------+
| [Previous ] [  Pause  ] [  Next  ]          [QR] Class code      [  End  ]  |
| [Interval ] [         ] [  Song  ]          [QR] KXPD-RMTB                  |
|                                             [QR] Phone remote on             |
+------------------------------------------------------------------------------+
  5 vw safe edge                                                     95 vw
```

| Part | Size (16:9 to 3:2) | At 3:2 and narrower | Type |
|---|---|---|---|
| Buttons | 11 vh high, at least 11 vw wide (Start / Pause / Resume 13 vw, End 9 vw), 1 vw apart, `--stage-raised` with a 0.3 vh `--stage-line` border, radius 0.8 vh; the main one a 0.5 vh `--light-1` border | 9.4 vh high, as wide as the words, 0.8 vw apart; main 11 vw, End 8 vw | Word: `--t-control` (Atkinson 700, 3.6 vh), `--light-1`. Second line: Big Shoulders 600, `--t-label`, `--light-2` (the condensed face so that three "Stops following" fit at 5:4) |
| Class code | QR code 12.4 vh square; beside it "Class code" (label), the code, one state line | QR 10.8 vh, the three lines 0.2 vh apart | Code: Big Shoulders 800, `--t-minor`, `--light-1`. Label and state line: `--t-label` |
| Focus | 0.4 vh `--light-1` outline, 0.4 vh outside the button (the class list's ring) | the same | |

Words are always words: no button is an icon alone. No hue anywhere in the band (rule 7, C6):
it is white, grey and black, and the QR code is black on white.

### End, and its guard

- **End** opens a question in the band, which replaces the buttons: "End the class?"
  (`--t-text-min`), **"End class"** with the second line "Back to the class list", and
  **"Keep going"**, which has the focus and sits where End was. A second click on End (a
  double-click, a nervous click) lands on "Keep going". "End class" is at least 5 vw left of
  where End was.
- No answer in 8 s, Esc, or a click outside the band: "Keep going". The band then hides as usual.
- **End class** leaves the class: the room window closes and the class list comes back (the class
  is no longer pinned; class-list.md, "When the room window closes"). It sends nothing to the
  music app (no new behaviour: no command for it exists) and ends the phone remote, as closing a
  class does (ADR 0005, section 2).
- **On "Class Complete"** there is nothing left to lose: the band holds one button, "Close class"
  with "Back to the class list", in End's place, with no question.

### The class code

The code a phone uses to find this class: the **riders' join code** of ADR 0002 (`XXXX-XXXX`,
`joinCode` in `schema/live/v1/session-answer.schema.json`), labelled "Class code" as on the
companion page. It names the session only (rule 14) and gives no control by itself: a phone
steers the class only with the instructor's sign-in (ADR 0002 section 8; ADR 0005 section 3).

**Never a control code.** The companion's one-time control code (`control_code`) is never shown
on the room screen, in the band or anywhere else, and never sent to the room window: every rider
can see this screen. That stays exactly as ADR 0005 has it (guard: "the control code is sent only
on the presenter's channel, never on the room window's"). How a one-screen instructor gets
control by code is an open question for the owner; until it is answered, one screen means
control by sign-in only, as ADR 0002 section 8 already says for one display.

**Where and when.** Only in the band, between Next and End, so only while the band shows, and
never over the numbers. With one display that means always before the start (the band does not
hide then) and on a mouse move during the class. It is not on "Class Complete". Whenever the code
is on, it is shown **as text and as a QR code** of `https://<site>/control#<join code>` (ADR 0005
section 2; companion.md): the join code in the fragment and nothing else. Opening it on a phone
fills in the class code on the companion page and offers sign-in; control still needs the
instructor's sign-in.

**The slot's states.** A build without the live client always shows the slot absent.

| State | When (ADR 0005) | The slot shows | Mock-up |
|---|---|---|---|
| Absent | No live client in this build; the app is not paired (class files only); a pairing that no longer works | Nothing, and no gap or explanation on the room screen (riders need none): Next is followed by End. The presenter, when there is one, says why (ADR 0005, section 2) | [no code](mockups/room-controls-no-code.html) |
| Off | Paired and online, no phone remote for this class (the default at each start of the app) | A button "Phone remote", second line "Show the class code". Pressing it starts the live session (ADR 0005: on the instructor's request, never automatically). With one display this button is ADR 0005 section 2's instructor request, which the presenter makes with a second display | [manual, before the start](mockups/room-controls-manual.html) |
| Starting | `POST /api/live/sessions` sent | The same button, disabled, second line "Getting a code" | [html](mockups/room-controls-slot-starting.html) |
| On | Session running | The QR code, "Class code", the code, state line "Phone remote on" | [before the start](mockups/room-controls-before-start.html), [running](mockups/room-controls-running.html) |
| Phone connected | `controller_joined` | State line "Phone connected", or "2 phones connected". Nothing else about the phones (no names, no list) | [paused](mockups/room-controls-paused.html), [worst case](mockups/room-controls-worst.html) |
| Reconnecting | The host connection dropped (ADR 0005 section 6) | The code stays; state line "Reconnecting" | [html](mockups/room-controls-slot-reconnecting.html) |
| Refused | 409 `sessions_full` | The Off button, second line "In use elsewhere" | [html](mockups/room-controls-slot-refused.html) |
| No answer | A start that got no answer, or an unreachable site | The Off button, second line "Can't reach site". Pressing it tries again. The note lasts until the band next hides, like "Phone remote ended" | [html](mockups/room-controls-slot-unreachable.html) |
| Ended | `ended`, or the reconnect is refused | Back to Off, second line "Phone remote ended" until the band next hides | [html](mockups/room-controls-slot-ended.html) |

State lines are at most 18 characters ("2 phones connected"), so the slot fits at 5:4 beside three
"Stops following" buttons (the worst case). The slot never shows a rider count, nickname or any
rider data (rule 13), a token, a control code, an account or a device name.

### Keyboard

The room window takes the keyboard when it opens, only if the application already has it (as
class-list.md says for the presenter). The same keys work in the presenter window when it has the
focus. None of them needs the band to be shown. Page Up and Page Down are what a presentation
clicker sends, so a clicker in the instructor's hand works as Previous and Next.

| Key | Does | On the band |
|---|---|---|
| Space | Start, Pause or Resume: what the main button shows | Yes |
| Right arrow, Page Down | Next (the band's routing) | Yes |
| Left arrow, Page Up | Previous | Yes |
| End | Opens the End question (shows the band); Enter then answers the focused "Keep going" | Yes |
| Shift+Right, Shift+Left | Forward 5 s, Back 5 s (`jump`, ±`JUMP_MS`; while following this hands the clock over, and the rail shows "Manual clock") | No: keyboard and presenter only |
| Ctrl+Z (Cmd+Z) | Undo an announced resync while it can be undone (ADR 0001, item 5) | No |
| F5, Shift+F5 | A presentation clicker's "start the show" key: Start, only before the start; after it, nothing, so a clicker that sends F5 and Esc by turns never pauses a running class | No |
| B, . (period) | A clicker's "black screen" keys: nothing. The room screen never goes blank | No |
| F | Follow the music (`follow`), when the music could be followed; otherwise nothing. Named in the rail while the clock is manual ("Back to following the music") | No: the rail names it |
| Tab, Shift+Tab | Shows the band and moves through its buttons | |
| Enter | The focused button | |
| Esc | Closes the End question ("Keep going"); otherwise hides the band at once | |

**While the End question is open**, Space, the arrows (with or without Shift), Page Up and Page
Down do nothing, so a stray clicker press or a nudged key cannot move the class or answer the
question. Esc, Enter, Tab, Undo (Ctrl+Z), F and End still work (End leaves the focus on "Keep
going").

Clicker keys, as built (#207): F5 and Shift+F5 are Start only before the class starts; B and
period do nothing, so the room never goes blank; Page Up and Page Down are Previous and Next.

A held key repeats nothing: one press, one command (Ctrl+Z too). None of the clicker keys (Page Up,
Page Down, F5, Shift+F5, B, period) shows the band.

Manual clock and picking an occurrence stay on the presenter and the application menu; they are
not keys. Follow the music is both: the presenter's button and F.

### Motion

The band appears and fades with `--m-state` (300 ms, ease out). With reduced motion it is there
and gone at once (0 ms, C7). Nothing in it moves, blinks or pulses; the score under it keeps its
own motion.

### Mock-ups

Built from the state mock-ups above with [mockups/controls.css](mockups/controls.css); the QR code
is a placeholder of the right size, not a real code ([qr-placeholder.svg](mockups/qr-placeholder.svg)).

| State | Mock-up | Screenshot |
|---|---|---|
| Before the start, following, code with QR | [html](mockups/room-controls-before-start.html) | [16:9](mockups/room-controls-before-start-1920x1080.png) |
| Before the start, manual clock, phone remote off | [html](mockups/room-controls-manual.html) | [16:9](mockups/room-controls-manual-1920x1080.png) |
| Running, following: Next is "Song", Previous "Stops following"; code with QR | [html](mockups/room-controls-running.html) | [16:9](mockups/room-controls-running-1920x1080.png), [4:3](mockups/room-controls-running-1440x1080.png), [reduced motion](mockups/room-controls-running-reduced-1920x1080.png) |
| Paused: Resume; code with QR, a phone connected | [html](mockups/room-controls-paused.html) | [16:9](mockups/room-controls-paused-1920x1080.png) |
| Running, manual clock, no phone remote (slot absent) | [html](mockups/room-controls-no-code.html) | [16:9](mockups/room-controls-no-code-1920x1080.png) |
| Slot: Starting, Reconnecting, In use elsewhere, No answer, Phone remote ended | [starting](mockups/room-controls-slot-starting.html), [reconnecting](mockups/room-controls-slot-reconnecting.html), [refused](mockups/room-controls-slot-refused.html), [unreachable](mockups/room-controls-slot-unreachable.html), [ended](mockups/room-controls-slot-ended.html) | CI screenshots (not kept) |
| The End question | [html](mockups/room-controls-end.html) | [16:9](mockups/room-controls-end-1920x1080.png) |
| Class Complete: Close class | [html](mockups/room-controls-finished.html) | [16:9](mockups/room-controls-finished-1920x1080.png) |
| Worst case: three "Stops following", code with QR, "2 phones connected", over the worst running fixture | [html](mockups/room-controls-worst.html) | checked at all ten sizes; kept: [2560×1080](mockups/room-controls-worst-2560x1080.png), [1280×720](mockups/room-controls-worst-1280x720.png), [1650×1080](mockups/room-controls-worst-1650x1080.png), [1024×768](mockups/room-controls-worst-1024x768.png), [5:4](mockups/room-controls-worst-1280x1024.png) |

The state with the band hidden is the state mock-up itself (for example
[running](mockups/room-running.html)).

## What the screen never shows (plan section 3)

| Rule | How this screen keeps it |
|---|---|
| 1. Displays a finished class only | No editing, no reordering, no song choice on this screen or the presenter. The room screen's only controls are Start, Pause, Resume, Previous, Next and End, which move through the class as written, the class code slot's Phone remote button, which starts or stops the phone remote, and the F key, which follows the music again; Next while following asks the music app for the next track of the instructor's own playlist and chooses nothing |
| 2. Software only, never controls equipment | No control of resistance, incline, brake or speed anywhere; "Standing" and "Seated" are words for the rider. The band's buttons reach only the class clock and the music app's play, pause and next |
| 3. Spotify's music stays in Spotify's app | The screen only names the song and shows the link state; nothing here plays, stores or downloads audio |
| 4. No road, ribbon, track, terrain or world | The score is a flat strip of equal-height blocks moving sideways like a music editor; no block has a height, slope or shape from an interval; no perspective, no horizon, nothing travelled along |
| 5. No viewpoint or rider moving through a scene | Nothing moves at a speed from data; no sensor data is shown in this version |
| 6. None of MOWL's look | No ring trio or ring of any kind, no row of class bars along the top, no grid of rider circles, no bar per rider against a target, no owl, flames, player or game names; our own palette (system.md) |
| 7. Colour means the planned zone | Hue only on things that stand for a planned zone; every state, plate, control and the QR code is white, grey or black (check C6) |
| 8. No hand-position icons, no "adjust by your heart rate" | Position is a word; no hand icon; no heart-rate instruction |
| 9. Own names for load figures | "Class load" (from `totals.planned_load`); never TSS, Training Stress Score, Normalized Power or Intensity Factor |
| 10. Cues are designed text | The cue is shown as written in the class; no generated text, nothing spoken |
| 11. Nothing generated from past sessions | No suggestions, scores against earlier rides or automatic changes of intensity |
| 12. No camera | None |
| 13. Rider data one way | No rider data, list, ranking or comparison on the room screen; the class code slot says only whether the instructor's phones are connected, never anything about a rider |
| 14. Join code is a session id only | The class code is the join code alone, shown only in the control band; its QR address carries the code in the fragment and nothing else. Control needs the instructor's sign-in; a control code is never on this screen |
| 15. No team games | None |

## Measurable checks

These are what a Developer builds against and what CI checks on the real screen's screenshots
in PL4, at every supported size with the worst-case content. On the mock-ups,
[mockups/shoot.js](mockups/shoot.js) takes the screenshots and then runs
[mockups/measure.js](mockups/measure.js) on every shot in [mockups/shots.js](mockups/shots.js)
(the states, four more states at three sizes, the eight worst cases at all ten sizes, the control
band in its states and its worst case at all ten sizes, the way back to following the music and
its two worst cases at all ten sizes, and the presenter at two: 159 room and presenter shots,
about sixteen minutes with Playwright and Chromium, animations stopped at their first
frame so every PNG reproduces); it exits non-zero on any failure and ends with a summary table of
fixture by size. Every check passes on every shot.

| Check | Requirement |
|---|---|
| C1. Text height | **Measured in the product's own browser** on the real screen (the CI Chromium), not on the mock-ups: its font metrics give cap heights about 2.3 % lower than the mock-up browser, which is why the product's value sizes carry the margin given under "Layout". The floors below are not lowered. Cap height as a share of the screen height, at every room size: countdown at least 20 %; gel numeral at least 25 %; values (zone name, cadence, position, BPM) at least 5.5 % (a zone name stepped down by the fitting rules: 3 %); the cue, class time and the next interval at least 3 %; labels and score text at least 2 %. Not applied to the presenter window or the preview |
| C2. Contrast | WCAG 2 ratio between the text colour and the worst rendered background pixel inside the text's ink: at least 7 : 1 for everything except labels, at least 4.5 : 1 for labels |
| C3. Safe area | All text ink within 5 % of every edge |
| C4. No collisions | No two pieces of text overlap; no text is covered by a fill (the score over a list); no text wraps to more lines than its slot allows (one unless the spec says more); no text is cut off by its own box or a container, except a designed ellipsis and the score labels shown only when they fit whole; the ink of the next row ends at least 0.7 vh above the top of the score at every size (5.04 px at 1280×720; a minimum: no design may go below it; CI checks it on every room screenshot, with a tolerance of 0.5 px for the ink trim described below) |
| C5. Zone | Every zone colour carries its number; the gel, the next row and the time-in-zone list also carry the name; a score block shows its name if and only if the whole name fits beside the number, and never draws it cut. Past score blocks carry no zone colour |
| C6. Hue | Any text, fill or border that is not grey lies inside an element that stands for a zone. Not covered by the mock-up script: hue inside `box-shadow` and gradients (the gel's glow is the zone's own colour); PL4 CI must cover them or forbid hue there |
| C7. Motion | With reduced motion, no transition or animation lasts longer than 0; without it, nothing that repeats (the beat dot) cycles more than three times a second. The mock-ups can only check CSS animations and transitions: PL4 CI must also cover the beat dot's real timing (at least 1/3 s between the starts of two lights, including with tempo drift near 180 BPM), the 160 ms edge flash and the score's movement (continuous, and whole-second steps with reduced motion) |
| C8. Coverage | Every piece of text on the screen is inside an element the checks see (in the mock-ups: a `data-tier` element), so no text escapes C1 to C4 |
| C10. Control band | Hidden: the screenshot equals the same state without the band, pixel for pixel, with no pointer. Shown: every pixel outside the score's box equals the hidden screenshot (the band covers the score and nothing else). Band text passes C1 to C4 at the label floor (2 %), the class code at 3 %; button words measure 2.4 % on the mock-ups. Buttons are at least 9.4 vh high (72 px at 768 lines). The QR code has at least 2 px per module at every supported size (29 modules and a 4-module quiet zone in 12.4 vh, or 10.8 vh at 3:2 and narrower) and is black on white. "Keep going" covers the centre of End's box; "End class" is at least 5 vw from it. **Behaviour, PL4 CI only** (the mock-ups are static and cannot check it): the band hides 3 s after the last input of each kind (pointer move, click, tap, key press); a pointer resting over the band does not hold it; after a button is pressed by click or tap the band still hides 3 s later; keyboard focus reached by Tab holds it, and so does the End question, until Esc or an answer; with one display it does not hide before the start or on "Class Complete"; a click or tap while hidden, or during the fade-out, presses nothing and only shows the band; on touch a tap is the only way in; with reduced motion it appears and hides in 0 ms; F follows the music without showing the band; while the End question is open the transport keys do nothing. No control code reaches the room window on any room channel (ADR 0005's guard, extended to the new channels) |
| C9. Palette | From `tokens.css`, by [mockups/palette.js](mockups/palette.js): every zone at least 7 : 1 with black on it, on the stage and on the lights-down gel; neighbouring zones at least ΔE 30 apart for normal vision, 25 for protanopia and deuteranopia, 12 for tritanopia (system.md) |

How the mock-up script finds ink ([mockups/ink.js](mockups/ink.js)): a pixel is ink when it differs
from the picture without text by more than 90 (sum of the RGB differences), and lone pixels are
dropped (Chromium repaints anti-aliased corners near the text slightly differently). This trims a
light-on-dark ink box by about a pixel at its edges, which C1 to C4 tolerate on the mock-ups; the
PL4 CI check states its own threshold.

What a check means for a room 12 m deep with a 3 m wide 16:9 image (1.69 m high): labels at
2.1 % are 36 mm capitals, the cue at 3.6 % is 61 mm, values at 6.8 % are 115 mm and the
countdown at 29 % is about 490 mm.
