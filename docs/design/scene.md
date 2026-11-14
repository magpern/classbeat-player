# Screen spec: the 3D room scene ("the rig")

Status: proposed for phase PL6 (plan sections 3 and 9); closes #474. Scene technology: web 3D
in the room window, as decided in [ADR 0009](../adr/0009-the-room-scene-is-web-3d.md) (three.js in the shell's
window), with the text as HTML over it. Design system:
[system.md](system.md); the plain 2D screen it falls back to: [room-2d.md](room-2d.md).
Reference mock-up: [mockups/scene-rig.html](mockups/scene-rig.html) (open it in a browser; see
"The mock-up" at the end).

## Why a new direction

Spike 2 (owner, 2026-11-14): the Godot variants did not run on the owner's Mac; the `web` variant
"looks ok, but it is not so fascinating .. just a pulsing star"; "neither looks very good". The
spike scene was one flat object: a glow and a fan of lines that scaled on the BPM, the same for
45 minutes. Nothing in it knew about songs, phrases, drops or what comes next.

Owner input the same day, binding for this spec:

1. **See what is ahead**: "at least the next 5 or 10 minutes". The score shows at least 5
   minutes ahead at every size (8 at 16:9), with each upcoming interval's zone (number, name,
   colour), length and cue.
2. **"More 3D stuff. Follow music."** A real 3D space with depth, light that moves with the
   beat, the phrases, the drops and the song changes, not one pulsing object.
3. **"If level is blue, more blue in graphics, if it is red more red."** The whole scene takes
   the current zone's colour, strongly, its energy rises with the zone, and the next zone's
   colour is seen coming before the change.
4. **Intervals first, songs second**: "we are very song oriented. There could be a climb inside
   a song. Or 8 beat up and down in a song." The score and the screen are built on the
   intervals, which sit on the class clock, several inside one song (a climb in three steps,
   each visible ahead), and on **beat-counted position patterns** (class format 1.1, #470:
   `interval.pattern`, for example standing and seated for 8 beats each). The
   current side, a big beat count to the next switch and the upcoming patterns are shown;
   songs stay the score's lower track. See "Intervals first: climbs and patterns".

## Directions considered

| | A. The rig (chosen) | B. The wall | C. The tubes |
|---|---|---|---|
| What it is | A concert lighting rig seen from the audience: two trusses of moving heads and a row of floor uplights, beams cutting through haze in a deep, dark room, an LED wall at the back | A stage LED wall filling the screen: thousands of light dots playing chases, wipes and sweeps | Rows of vertical pixel tubes standing at different depths, light running along them |
| Depth | Real: beams are 3D cones seen in perspective, crossing in front of and behind each other; two trusses at different depths; the wall far behind | Flat; depth only by blur | Some: rows of tubes in perspective |
| Following music | Beat lifts the beams, phrases change the pattern, each song re-aims the rig to its own look, a build gathers the beams, a drop bursts them open | Beat and phrase as chases; good, but always the same plane | Beat as runs along the tubes |
| 45 minutes in a dark studio | Reads as the room's own light show; the colour floods the haze, so the room "is" the zone | A screensaver after ten minutes; very bright, glare on a projector | Strong for a few songs, then repetitive; tubes moving up and down would come close to heights from data (rule 4) |
| Under large text | Haze is soft and can be held dark under text without looking patched | Hard dots behind text read as noise | Thin bright lines behind digits break the numbers |
| Cost | One full-screen shader, about 22 beams; scales down with render resolution | Cheap | Moderate |

**Choice: A, the rig, with B's wall as its back layer.** It is what a cycling studio's own
lighting would be if it had one, it is genuinely three-dimensional without being a place (no
ground, no horizon, nothing travelled along, a fixed camera), and every musical event has a
natural lighting move: lift on the beat, a new pattern on the phrase, re-aim at a song change,
gather on a build, burst on a drop, one slow beam in a breakdown. It also keeps the plan's
wording ("the screen is the studio's light rig") and needs no external hardware (plan section 3:
studio lights are ruled out; this is light on the screen only).

## Purpose

The room screen when the scene is on: the same class, in step with the music, readable from a
bike up to about 12 m away, with the room's light show behind the text. The plain 2D screen is
always there underneath (plan section 9: it takes over within 2 s if the scene fails, and it is
the screen with reduced motion, see "Reduced motion"). The control band, the class code and the
keyboard are exactly those of room-2d.md ("Controls on the room screen"); the band covers the
score's box here too.

## Content, in priority order

The nine items of room-2d.md, all visible at once in every running state, so that falling back
to the 2D screen never loses anything:

1. Time left in the interval, and with beat anchors, the bars to the change.
2. The zone: number, name and colour, with its target ranges.
3. Cadence and position; in an interval with a position pattern, the **current side and a
   big beat count to the next switch** ("UP 8 … 1", then "DOWN").
4. The song's BPM.
5. The cue.
6. What comes next: the next zone (number, name, colour), length, cadence, position or pattern,
   and **its cue**.
7. **The score, now 8 minutes ahead** (owner input 1), **intervals first** (owner input 4):
   intervals with zone number, length, name, pattern and cue, so a climb of three intervals
   inside one song reads as three steps; under them, songs as clips with title, artist, BPM and
   moments (drop, build, breakdown).
8. Time in the class, left and done; the segment.
9. The music-link state.

And, behind all of it, **the rig** (not information: nothing has to be read from it, everything
it shows is also in text).

## The scene

A fixed camera looks into a deep black room filled with light haze. Nothing in the room is a
place: no floor, no horizon, no road, nothing approaches or recedes.

| Layer | Depth (scene units, camera at 0) | What |
|---|---|---|
| Front truss | 16 | 8 moving heads in a row along the top edge; their beams fall into the room |
| Floor uplights | 19 | 6 fixtures hidden behind the score, beams rising in pairs |
| Back truss | 23 | 8 moving heads higher up, aimed partly toward the riders, so their lenses glow |
| LED wall | 26 | A grid of 56 × 14 light dots behind everything, playing slow waves and beat chases |
| Haze | everywhere | Slowly drifting density that the beams light; the zone colour's ambient glow |

**The camera never moves** (rule 5). Depth comes from perspective: beams cross in front of and
behind each other, the back truss is smaller and dimmer than the front, the wall is far away.

### What drives what

The separation keeps rule 4: **the interval gives colour and energy, the music gives movement,
nothing gives shape.** A beam's direction is a function of five things only: the song's look,
the fixture, the **motion phase**, the phrase (mirroring) and the song's marked moments (gather,
fan). The interval reaches the rig only as scalars: colour, brightness, how many fixtures are
lit, the beat lift's depth, the haze level, and the **rate** at which the motion phase advances
(at most 6 to 30 degrees a second by zone, the table below). No beam angle, length, height or
slope is taken from an interval's values, and nothing aims at an interval's timing.

| Source | Drives | Never drives |
|---|---|---|
| The planned zone of the interval | Colour of every light; **energy** (table below): brightness, how many fixtures are lit, how fast they move, how deep the beat lift is, how dense the haze glows | Any angle, height or shape |
| The song (its order in the class) | The **look**: the pattern the rig is aimed in (fan, cross, sweep, circle, split). The same class always gets the same looks | Colour |
| The beat (see "How much of the music is known") | A lift of every lit beam and a step of the wall's chase, at most 3 a second | Movement speed |
| The phrase (every 8 bars from the anchors) | The look's variation: mirrored, chase direction, which half leads | |
| A song change | The rig dims for one beat and re-aims to the new song's look in 1.2 s | |
| Moments (`build`, `drop`, `breakdown`) | Build: the 8 beats before a drop (or the `build` moment) gather every beam to one point, the haze brightens, the lift deepens. Drop: one white burst, then every fixture on and fanned wide for 4 bars. Breakdown: one slow beam and the wall, for 8 bars | |
| No moments in the song | Bursts follow the interval changes inside the song (plan section 4), at least 10 s apart: **light only**, no gather and no fan, so no direction follows an interval's timing | Any angle |
| The next interval | **Anticipation**: in the last 10 s before an interval change the back truss and the LED wall turn to the next zone's colour, as a wipe from the far side; the front truss changes at the change | |
| A position pattern (format 1.1, beat known) | **Energy only**: the beams at full brightness on the "up" side and at 72 % on the "down" side, and a 25 % accent on the first beat of each side. At most one accent per side, so at most 3 a second | Any angle, height or shape (the rig does not "stand up") |
| Link state | Without a lock, no beat and no tempo pulse (as the 2D beat dot); see the states | |

### How much of the music is known

Plan section 4 and ADR 0003 section 5 set what the scene may do with what the class file gives.
Nothing beat-like is ever guessed: a downbeat that is not known is not drawn.

| Level | When | What runs |
|---|---|---|
| **Beat** | Link locked, the song has `bpm` and `beat_anchors` | Everything: beat lift, wall chase, phrase mirroring, the bars line, the pattern count (both `start_on` values), the pattern accent |
| **Tempo only** | Link locked, `bpm` but no anchors | A shallow **tempo pulse** of the lit beams (12 %, its own phase, not claimed to be on the beat); no wall chase, no phrase, no bars line, no pattern accent. The pattern count runs only for `start_on: "interval_start"` (the default), counted at the bpm from the interval's start; a `next_downbeat` pattern shows "count from the music" |
| **None** | No lock (coasting, off the list, paused, manual clock, hold), or the song has no `bpm` (`pattern_without_bpm`, ADR 0003) | No lift, no pulse, no accent, no count; the zone's colour and energy and the motion stay |

Moments are independent: a song without marked moments gets bursts on its interval changes
(table above); a song with them never also bursts on an interval change.

### Energy by zone (owner input 3)

The colour is the zone token, unchanged ([tokens.css](mockups/tokens.css)); it floods the haze,
the beams, the lenses and the wall, so a zone 1 room is unmistakably sky blue and a zone 6 room
coral. Energy rises with the zone:

| Zone | Ambient glow | Fixtures lit (of 22) | Movement (deg/s, at most) | Beat lift | Wall |
|---|---|---|---|---|---|
| 1 | 0.045 | 8 | 6 | 15 % | Slow wave |
| 2 | 0.055 | 10 | 8 | 18 % | Slow wave |
| 3 | 0.065 | 12 | 11 | 22 % | Wave and beat |
| 4 | 0.075 | 15 | 15 | 27 % | Beat chase |
| 5 | 0.085 | 17 | 19 | 32 % | Beat chase |
| 6 | 0.095 | 20 | 24 | 38 % | Beat chase, both ways |
| 7 | 0.11 | 22 | 30 | 45 % | Beat chase, both ways |

"Ambient glow" is the linear-light level of the zone colour lighting the haze and the room, before
the beams and before the text rule below; it is kept low so the beams carry the light. A class with
fewer than seven zones uses the rows of its own zone numbers.

## Layout

All sizes are shares of the screen. Safe area 5 % on every side for text. The scene fills the
whole window behind everything; the gel plate and the score are opaque.

### 16:9 and 16:10 (anything wider than 3:2)

```
+--------+-----------------------------------------------------------------+
| Zone   | 17:00 left  7:01 done                 Main set  * Following     |
|  6     | Cadence      8 up, 8 down      Interval left  26 bars to change |
|        | 70-80 rpm    UP  7                                              |
|        | Position     ########.        1:10                              |
|        | Up / down    then down                                          |
|        | Song                  Next [2] Endurance 1:00 85-95 rpm Seated  |
|Anaer.  | 124 bpm               Sit down, spin it out. Drink.             |
|121-150%| Jumps on the drop: 8 up, 8 down. Land soft.                     |
+--------+-----------------------------------------------------------------+
| //|6 1:14 Anaer.  |2 1:00 Endur.  |5 1:10 VO2 max      |3 0:40 ...     |  intervals
| //|8 up, 8 down...|Sit down, s... |Push through...     |Break...       |  pattern, cues
| //|Neon Avenue      |Pulse Theory  Aurora Lane 132 bpm | Drop            |  songs
|   ^ now (10 vw)                                         8 minutes ahead  |
+--------------------------------------------------------------------------+

| Region | Box | Content |
|---|---|---|
| Gel plate | 0, 0, 24 vw, 68.4 vh; opaque zone colour | "Zone" label, numeral (32 vh, Big Shoulders 800, ink), name (at most min(7.6 vh, 4.4 vw), two lines; a name that cannot fit two lines steps to `--t-minor` as room-2d.md), targets (`--t-minor`) |
| Rail | 27 vw, 5 vh, to 95 vw | Class time left and done, segment, link state (as room-2d.md) |
| Metrics | 27 vw, 12 vh, stacked | Cadence, position, BPM: label `--t-label`, value 7.6 vh (Big Shoulders 800), unit `--t-minor` |
| Clock | right-aligned to 95 vw, from 10.4 vh | First line: label and bars line side by side (`--t-minor`); under it the countdown (26 vh, cap 21.1 %); see "Fitting" |
| Pattern | from 46 vw, or 2 vw right of the widest metric value if that is further right, from 10.4 vh; only in an interval with a pattern | See "Intervals first: climbs and patterns" and "Fitting" |
| Next | right-aligned to 95 vw, 1.2 vh under the countdown (about 38 to 54 vh) | Line 1: "Next", zone chip, name, length, cadence, position or pattern ("8 up, 8 down") (`--t-minor`, one line). Line 2: **the next interval's cue** (`--t-label`, at most 52 vw wide, at most 3 lines) |
| Cue | 27 vw to 95 vw, ends at 68.4 vh | `--t-text`, two lines; over 60 characters `--t-text-min`, three lines |
| Score | 0, 70.4 vh, full width, to 95 vh | See "The score" |
| Stage | everything else | The rig at full brightness |

### 4:3 and narrower (3:2 and narrower)

| Region | Box | Content |
|---|---|---|
| Gel plate | 0, 0, 30 vw, 48 vh | Numeral 28 vh (cap 22.8 %), name 7 vh (cap 5.7 %), targets |
| Rail | 33 vw, 5 vh, to 95 vw | As 16:9, without the segment name |
| Metrics | 33 vw, from 16 vh, ending by 46 vh | Value and unit only, 7.2 vh (cap 5.85 %): the units ("rpm", "bpm") and the values ("Seated") carry the meaning, so no labels stand beside the countdown |
| Clock | right-aligned to 95 vw, from 10.4 vh | As 16:9: label and bars line, then the countdown at 26 vh |
| Next | 5 vw to 95 vw, from 48.5 vh | Line 1 as 16:9, left-aligned; line 2 the next cue (`--t-label`, at most 2 lines) |
| Cue | 5 vw to 95 vw, ends at 75.3 vh | `--t-text-min`, at most 3 lines |
| Score | 0, 76 vh, to 94.8 vh | Intervals 7 vh (no second line: the next cue is in the next row), songs 6.8 vh; **6 minutes** wide |

In an interval with a pattern there is no room for the pattern block: the Position value becomes
the side and the count (count at 1.8 × the value, 12.96 vh, cap 10.5 %), and the bars line stays.
Without a count the value reads "Count from the music" (`--t-minor`, at most two lines,
24 vw wide).
### Laptop and phone

- **Presenter preview (laptop, a second display only):** the preview shows the room as drawn,
  scene included, at the preview's size; the room-distance heights do not apply to it
  (room-2d.md). If the computer cannot hold the frame rate for both, the preview shows the
  plain screen and the room keeps the scene.
- **Phone on a handlebar:** the scene never runs on the companion; it keeps its own 2D design
  ([companion.md](companion.md)), read at arm's length on a moving bike, where a light show would
  only cost battery and attention. The rider's phone page likewise ([rider.md](rider.md)).

## The score (owner input 1)

- **Window:** 30 s behind "now" and **8 minutes ahead** at 16:9 and wider, 6 minutes at 3:2 and
  narrower, measured to the screen's right edge; text ends at the 95 vw safe edge, so every
  interval starting within the first **7 minutes** (16:9) or **5 minutes** (3:2 and narrower) is
  fully labelled. "Now" is a fixed white line at 10 vw.
  It moves continuously (0.19 vw a second at 16:9), whole-second steps with reduced motion.
- **Interval lane** (71.2 to 81.6 vh): each block is the zone colour with, in ink, its number
  (5 vh, Big Shoulders 800), then its **length**, then its name (`--t-label`, 700) on the first
  line, and its **cue** on the second (`--t-label`), ending in an ellipsis at the block's end.
  The length comes before the name and is guaranteed: every interval of **40 s or more** shows
  its number and its length at every supported size (40 s is 7.5 vw at 16:9 and 10 vw at 3:2 and narrower,
  and number plus length need at most 5.5 vw at 16:10 and 7.5 vw at 5:4). The name shows only when it fits whole after
  them; the cue when at least 6 vw is left. Blocks wholly in the past are grey with nothing on
  them; a current block keeps its labels just right of "now".
- **The zone colour never shows without its number** (as room-2d.md's edge rule): a block
  whose number cannot fit (narrower than about 2.5 vw, or cut by the right edge with too little
  of it inside the safe area) is drawn **neutral** (`--stage-raised`) in the middle of the lane,
  and **not drawn at all** where the right edge cuts it.
- **Song lane** (82.2 to 90.8 vh): clips in `--stage-raised` with title, then artist and BPM when
  they fit; a moment is a white tick with its word ("Drop", "Build", "Breakdown") under the title.
- **Phrase ticks** every 4 bars along the song lane's foot, as room-2d.md, only where the song
  has beat anchors.
- The score is flat, opaque and drawn by the text layer, never by the scene: it has no
  perspective, no glow from the rig, no height from an interval (rule 4).
- Text in the score is at the label tier (2 % cap height and above): it is read by the
  instructor at the front and by riders who look for it; the current cue is the large one.

## Intervals first: climbs and patterns (owner input 4)

Intervals sit on the class clock, not on songs (class format: `start_ms`, `length_ms`), so one
song may hold any number of them. The screen is built on the intervals; the song is context.

- **A climb inside a song** is several intervals in a row, each its own block in the score with
  its number, name, length and cue ("Climb, step 1 of 3"), so all its steps are visible ahead
  while the song clip underneath spans them. Nothing joins them into one block, and nothing
  draws a slope: the steps are blocks of equal height in rising zone colours (rule 4).
- **A position pattern** (format 1.1, #470; schema/class-format/README.md):
  `interval.pattern` alternates 2 to 4 positions on the song's beat, each for 1 to 64 beats, for
  example `{"kind": "alternate", "positions": ["standing", "seated"], "beats": [8, 8]}`.
  `position` stays required and equals `positions[0]`; a 1.1 reader follows the pattern, so the
  screen shows the pattern, not `position`. The pattern is cut at the interval's end.
  `start_on` is `"interval_start"` (the default: the count starts at the interval's start) or
  `"next_downbeat"` (the first bar's downbeat at or after it, which needs the beat anchors; see
  "How much of the music is known"). The words on screen are **UP** (standing) and **DOWN**
  (seated). A pattern of three or four entries works the same way: "4 up, 4 down, 8 up" counts
  4, 4, 8; where two neighbouring entries are the same side, the note says "then up again".

**Pattern block** (16:9; at 3:2 and narrower it is folded into the Position metric, see
Layout), top to bottom, all text in `--light-1`:

| Line | Content | Size |
|---|---|---|
| Label | The pattern as words: "8 up, 8 down", "4 up, 4 down, 8 up" | `--t-label` |
| Side and count | **UP** or **DOWN**, the side the room is on now, and beside it the beats left on this side, **8 … 1**, stepping on each beat | Side 9 vh, count 18 vh (cap 14.6 %), Big Shoulders 800 |
| Beats | One square per beat of this side (only for 8 beats or fewer): filled for the beats left, outlined for those done | squares 1.6 vh, outlined in `--light-1` |
| Note | "then down", "then up", "then up again"; before a `next_downbeat` start "starts on the next bar"; without a count "Count from the music" or "No tempo: count from the music" | `--t-label`, wraps within the block |

The Position metric shows "Up / down" while the block runs. The bars line beside the clock's
label stays (it counts to the interval change, the block counts to the next switch).

- **Without a count** (no lock: coasting, off the list, manual clock, hold; no `bpm`, the
  `pattern_without_bpm` warning; or a `next_downbeat` pattern without anchors): the count and
  the side are **never guessed**. The block keeps its label and says "Count from the music"
  (with no `bpm`: "No tempo: count from the music"); the instructor counts from what the room
  hears. The rig has no pattern accent.
- **In the score**: a block with a pattern starts its second line with the pattern in bold
  ("8 up, 8 down · Jumps on the drop…") and carries a 1 vh strip along its foot, dark on the
  "up" beats and clear on the "down" beats, on the pattern's own beat grid, so the rhythm of an
  upcoming pattern is visible minutes ahead; with no grid known (no `bpm`, or `next_downbeat`
  without anchors) the strip is left out and the words stay. The **next row** names it the same
  way.
- **Reduced motion**: the count still steps with the beat (it is information, not decoration);
  nothing else moves.

**Follow-up for room-2d.md (required before PL6 ships the scene).** The plain 2D screen is the
reduced-motion and Plain-quality screen, so it must not show less than the scene does. Its own
pull request (Designer) gives it: the pattern fold into the Position metric (side and count,
"Count from the music" without one), the next cue as a second line of the next row, and a score
of **at least 5 minutes ahead** at every size (today: 4.5). Until that merges, PL6's scene work
does not make reduced motion or Plain fall back to a screen that lacks them; the issue for it is
named in the PL6 milestone.

## Text over light: the dark-under-text rule

Text is HTML over the scene, never in the picture. The scene keeps the haze **dark under text**:
inside every text line's box, grown by 1.2 vh and faded out over a further 3 vh, the scene's
relative luminance is capped at **0.08** (the mock-up uses 0.075 as a margin). **All text over
the scene is `--light-1`** (relative luminance 0.905): labels, units, the bars line, the link
state, the pattern's label and note, the next cue. Hierarchy comes from size, weight and face,
never from a dimmer grey: `--light-2` at the same cap would give only 4.2 : 1 and `--light-3`
2.8 : 1. `--light-1` is then at least **7.3 : 1** against the worst scene pixel under it, every
frame, whatever the rig does ((0.905 + 0.05) / (0.08 + 0.05)). The estimated countdown keeps its
dashed underline (in `--light-1`) as its mark instead of a dimmer colour. The
light still shows there, dimmed and in colour, so the room stays the zone's colour behind the
numbers; it reads as the text standing in the haze's shadow. The gel plate and the score are
opaque and are checked as in room-2d.md.

Zone colours appear as text only on opaque fills (the gel, the score, the next chip), never
straight on the scene.

## Fitting

- **Countdown** 26 vh at every size. Four glyphs ("1:10") and five ("10:50", an interval of
  10 minutes or more) both fit right of the metrics at 16:9 and 16:10. At 3:2 and narrower the
  metrics carry no labels at all (see Layout), so a five-glyph countdown still leaves at least
  2 vw to the widest value.
- **Pattern block**: it starts at 46 vw or 2 vw right of the widest metric value. If its label,
  side, count or squares would come within 2 vw of the countdown's ink, the count steps to
  14.6 vh (cap 11.9 %) and the side to 7.4 vh; the note wraps in the width left.
- **Next row**: line 1 is one line; the next cue wraps at 52 vw (3 lines at most at 16:9; 2 at
  3:2 and narrower), and its ink ends at least 1.5 vh above the cue's first line.
- **Cue**: as room-2d.md (two lines at `--t-text`, over 60 characters `--t-text-min`, three
  lines); the box ends at 68.4 vh (16:9) or 75.3 vh (narrower) and grows upward.
- **Worst case** (checked in every state at every size): 120-character current and next cues,
  a five-glyph countdown, a pattern interval, cadence "100–110 rpm", the longest zone name.

## States

| State | Rig | Text layer |
|---|---|---|
| Before the start | House look: lights down to 6 % in the first zone's colour, two slow beams, the wall dark, no beat | As room-2d.md "Before the start" (gel lights down, class title, time in each zone) |
| Warm-up (zones 1 and 2) | Calm: few beams, slow sweep, a slow wave on the wall, shallow lift on the beat; the haze clearly blue or teal | Running layout |
| Each zone, 1 to 7 | Colour and energy from the table above | Running layout |
| Interval change coming (last 10 s) | Back truss and wall wipe to the next zone's colour from the far side; the front truss stays | Label "Change in" in the last 5 s (room-2d.md); the next row is the next zone with its number and name, so the second colour on screen always has its number beside it |
| Interval change | Front truss crosses to the new colour in 700 ms (`--m-change`); every lens flashes white once (160 ms, `--m-flash`), unless a burst falls on the same moment, which then replaces the lens flash (one event, not two); the gel crosses as in 2D | New values; one white line down the gel's edge |
| Song change | Rig dims to 25 % for one beat, re-aims to the new song's look over 1.2 s, back on the first beat of the new song | Score moves on; song clip and BPM change |
| Build (8 beats before a drop, or a `build` moment) | Beams gather to one point in the middle of the room, the haze brightens to 1.5 ×, the lift deepens to 55 % | Nothing new (the score shows the "Drop" tick) |
| Drop | One white burst over the whole scene (peak at 0.85 of white, 250 ms decay; the only full-screen flash), then every fixture on and fanned wide for 4 bars, then the zone's own energy | Unchanged; the text is never flashed (dark-under-text holds during the burst) |
| Breakdown | One slow beam on the front truss and the wall's wave for 8 bars | Unchanged |
| Paused | Lights down: everything to 6 %, frozen where it was | As 2D: gel lights down, "Paused" plate, link plate "Music paused" |
| Coasting (readings stopped or stale) | No beat at all (the beat cannot be measured); the rig keeps the zone's colour and moves at its energy | As 2D: "estimated", dimmed dashed countdown, link plate "Music not heard" |
| Off the list | "Holding" look: no beat, movement halved, brightness 60 %, the song look of the interval's planned song | As 2D: link plate "Not a class song", BPM "Song, planned" |
| Position pattern, beat known | The zone's look, beams at full on "up" and 72 % on "down", an accent on each switch | Pattern block: side, beat count, beat squares, "then …" |
| Position pattern, tempo only (no anchors) | Tempo pulse, no accent | `interval_start`: side and count at the bpm from the interval's start. `next_downbeat`: label and "Count from the music" |
| Position pattern before its first downbeat (`next_downbeat`) | As the zone | Side of the first entry and "starts on the next bar"; no count until the downbeat |
| Position pattern, no lock | No beat, no pattern accent | Pattern block: label and "Count from the music"; no side, no count |
| `pattern_without_bpm` (a pattern in a song with no `bpm`) | No beat, no pulse, no accent | Pattern block: label and "No tempo: count from the music"; the Song metric reads "Song, no tempo" and "–"; the score's strip is left out |
| No beat anchors (tempo only) | Tempo pulse of 12 %, no wall chase, no phrase mirroring | No bars line; no phrase ticks in the score |
| No marked moments | Light-only bursts on the song's interval changes, at least 10 s apart | No moment ticks in the score |
| Ambiguous, manual clock, hold at a song change | Ambiguous as running; manual clock and hold: no beat, movement at the zone's energy | As 2D |
| Last interval | As its zone | As 2D ("End" mark in the score) |
| Finished | House lights up: the rig white and still, at 40 %; the wall white | As 2D "Class Complete" (white gel) |
| Scene killed or too slow | The plain 2D screen within 2 s, in the clock's state (plan section 9) | **One cut**, no animation: the text jumps once from this layout to room-2d.md's layout with the same values; the clock does not pause or restart |

## Motion and reduced motion

- **Limits, always:** nothing lifts, steps or flashes more than **3 times a second** (above
  180 BPM the lift is on every second beat, as the 2D beat dot); a beam turns at most 30 degrees
  a second; the white drop burst is the only full-screen flash, at most once per drop moment and
  never within 10 s of another, and counted within the 3-a-second limit; the lens flash at an
  interval change is the other orchestrated moment (a burst on the same moment replaces it). The beat lift is a brightness change of at most 45 % (55 % in a build) on the beams
  only, never on the gel or the text.
- **Reduced motion** (the system setting or the player's own): the room shows the **plain 2D
  screen** (plan section 3: plain mode is for reduced motion). Where the scene is shown anyway
  (the presenter preview, CI's reduced screenshots), it is the **still rig**: the song's look
  frozen, no beat lift, no sweep, no wall chase, no burst, no lens flash, colour changes instant,
  anticipation shown as an instant change of the back truss's colour, the score in whole-second
  steps. The pattern count still steps with the beat: it is information, not decoration. No
  state relies on motion to be understood.

## Quality levels

| Level | Render scale | Fixtures | Haze | Used when |
|---|---|---|---|---|
| High | 0.75 of the window | 22 | Two layers | Default |
| Medium | 0.5 | 16 | One layer | High under 50 fps for 5 s |
| Low | 0.35 | 10 | One layer, no wall | Medium under 45 fps for 5 s |
| Plain | none | | | Low under 30 fps for 5 s: the plain 2D screen, and the scene does not come back in that class |

The text layer is always at full resolution; only the scene is scaled (soft light hides it).

## Measurable criteria

Checked by CI on screenshots of the real room window in each state at the room sizes of
room-2d.md (and on the mock-up by eye until PL6's first pull request ships its checks).

| Check | Requirement |
|---|---|
| S1. Text height (cap height / screen height) | As C1, **measured in the product's own browser** (cap heights about 2.3 % lower than the mock-up's), so the product's sizes carry that margin over the floors, which are not lowered. Countdown at least **20 %** (26 vh gives 21.1 %); zone numeral at least **25 %** wider than 3:2 (32 vh: 26.0 %) and **22 %** at 3:2 and narrower (28 vh: 22.8 %; a deliberate departure from C1's 25 %, so the clock, the metrics and a 6-minute score fit beside and under a 30 vw gel); metric values, zone name and pattern side at least **5.5 %** (narrow values 7.2 vh: 5.85 %; narrow name 7 vh: 5.69 %; a name stepped down by the fitting rules: 3 %); the pattern's beat count at least **10 %** (14.6 % at 16:9, 11.9 % stepped, 10.5 % folded); the cue, class time and next row's first line at least **3 %**; labels, the next cue, link state and score text at least **2 %** |
| S2. Contrast | **Only `--light-1` text over the scene.** Text against the worst pixel under its ink, over a sequence of at least 120 frames covering a beat, a build, a drop and an interval change: at least **7 : 1** for every text on the scene, labels included. The scene's relative luminance inside each text box (grown by 1.2 vh, faded over 3 vh) is at most **0.08** on every frame. Text on opaque fills as room-2d.md |
| S3. Look-ahead | The score shows at least **5 minutes** ahead of "now" at every supported size (**8** at 16:9 and wider, **6** at 3:2 and narrower, to the screen's edge). Every interval of **40 s or more** starting within the labelled window (7 min at 16:9, 5 min narrower) shows its **number and its length**; any block that cannot show its number shows no zone colour. The **next interval's number, name, length, targets and cue are always on screen in the next row**, whatever the score shows |
| S4. Visible at once | All nine content items in every running state, with the band hidden, at every supported size |
| S5. Zone | The zone is a number and a name as well as a colour on the gel, the next row and the score (as C5); a score block never shows its colour without its number. The rig shows only the current zone's colour, the next zone's colour during the 10 s anticipation (while its number and name are in the next row), and white. Never another hue, never a measured heart-rate zone (rule 7) |
| S6. Flashes | No region larger than 10 % of the screen changes in relative luminance by more than 10 % more than 3 times in any second; the drop burst and the light-only bursts count within that limit. One full-screen burst per drop moment (or per interval change in a song without moments), at least 10 s apart |
| S7. Movement | The camera never moves. No beam turns faster than 30 degrees a second. Rule 4: a beam's direction is a function of the song's look, the fixture, the motion phase, the phrase and the song's moments only. Test (scene model): two classes that differ only in their intervals (zones, targets, positions, patterns, cues), evaluated at the same song, look, phrase, moments and **motion phase**, give every beam the same direction; and the motion phase's rate depends only on the zone's row, at most 30 degrees a second. Light-only bursts on interval changes change no direction |
| S8. Beat | Beat lift, wall chase, phrase and pattern accent only at the **Beat** level (lock, `bpm` and anchors), within 50 ms of the anchor beat (spike 1's criterion). At **Tempo only** a pulse of at most 12 % and nothing else beat-like. At **None** (paused, coasting, off the list, manual clock, holding, no `bpm`) no lift, pulse or accent. No downbeat is ever guessed |
| S9. Frame rate | At least 50 fps at High on the reference studio computer at 1920 × 1080; the quality steps of the table above, measured by the frame log |
| S10. Fallback | Scene killed: the plain 2D screen within 2 s, the clock continuous (plan section 9) |
| S11. Reduced motion | With reduced motion the room shows the plain screen; a still-rig screenshot shows no change between two frames 1 s apart except the score's one-second step, the countdown and the pattern count |
| S12. Hue in the text layer | As C6: hue only on elements that stand for a zone |
| S13. Intervals first | Every interval is its own block in the score: a test class with three intervals inside one song shows three blocks, each with its number, in the look-ahead window. A song clip never hides, merges or reorders interval blocks |
| S14. Pattern count | In an interval with a pattern and a known count (Beat level; or Tempo only with `start_on: "interval_start"`), the side and the count are on screen at all times; at the Beat level the count steps within **50 ms** of the anchor beat (as S8); the count reaches the next side exactly on the switch beat; the next side is named (also for three- and four-entry patterns). Otherwise no side and no count is shown and the block says why. Every pattern starting in the look-ahead window shows its words in the score or the next row |
| S15. Safe area | As C3: all text ink within 5 % of every edge, at every size and in every state |
| S16. No collisions | As C4, in every state at every supported size **and in the worst case** of "Fitting": no two pieces of text overlap and at least 1 vw (horizontal) or 1 vh (vertical) of clear space between separate pieces (the pattern block 2 vw from the countdown); no text covered by a fill; no text over more lines than its slot allows; the next row's ink ends at least 1.5 vh above the cue, and the cue's box at least 0.7 vh above the score (2 vh at 16:9; as C4) |

## Tokens

The scene reads the zone colours and type from `web/src/design/tokens.css` (system.md, "Shipping
the tokens"), never from its own table. Scene-only values, added to tokens.css by PL6's first
pull request:

| Token | Value | Use |
|---|---|---|
| `--scene-text-cap` | 0.08 | Highest relative luminance of the scene under text; valid for `--light-1` text only (S2) |
| `--scene-text-pad` | 1.2 vh, fade 3 vh | Growth of each text box for the cap |
| `--scene-down` | 0.06 | Lights down (paused, before the start), as the 2D gel |
| `--scene-house` | 0.40 | House lights (finished), white |
| `--scene-burst` | 0.85, 250 ms | The drop burst's peak share of white and its decay |
| `--scene-anticipate` | 10 s | How long before an interval change the next colour comes in |
| `--scene-reaim` | 1.2 s | A song change's re-aim |
| `--scene-lift-max` | 3 per second | The beat lift's highest rate |
| `--scene-tempo-pulse` | 0.12 | The tempo pulse's depth when there are no anchors |
| `--score-ahead` | 8 min (6 at 3:2 and narrower) | The score's look-ahead |
| `--score-now` | 10 vw | Where "now" is |
| `--pattern-count` | 18 vh (16:9), 14.6 vh stepped | The pattern's beat count |
| `--pattern-down` | 0.72 | Beam brightness on the "down" side of a pattern |
| `--m-change`, `--m-flash` | as system.md | Colour cross and lens flash at an interval change |

Energy by zone is a table in the scene's pure model module (`scene_model`), not a token: it is
behaviour, and a test holds it to the table above.

## The product rules (plan section 3)

| Rule | How the scene keeps it |
|---|---|
| 1. A finished class only | Nothing on the scene edits or chooses anything |
| 2. Never controls equipment | Light on the screen only; no studio lighting, no device control |
| 3. Spotify stays in Spotify | The scene hears nothing: it follows the class clock and the beat anchors from the class file |
| 4. No road, track, terrain or world | No ground, horizon or path; nothing travelled along; no beam direction from an interval, only scalars (S7). The score is flat |
| 5. No moving viewpoint | The camera is fixed |
| 6. None of MOWL's look | No rings, no row of class bars on top, no rider grid or bars, no flames; our palette; the rig is a stage, not their world |
| 7. Colour is the planned zone | S5; link states are white plates as in 2D |
| 8 to 12 | No hand icons, no heart-rate advice, our own load names, cues as written, nothing generated, no camera |
| 13 to 15 | No rider data on the room screen at all |

## The mock-up

[mockups/scene-rig.html](mockups/scene-rig.html): one file, no library and no network (plain
WebGL and the repository's own fonts and tokens next to it). It plays a fake 24-minute class
(six songs and twenty intervals: two climbs of three steps inside a song, two "8 up, 8 down"
patterns, the first with `start_on: "next_downbeat"`, and one "4 up, 4 down, 8 up", zones 1 to
7, four drops, a build, a breakdown) on a simulated clock. Its beat grid runs from each song's
start: a stand-in for the anchors. Open it in Chromium, Edge, Firefox or Safari, full screen (F11 or
Ctrl+Cmd+F), ideally on the studio projector in the dark.

- Move the mouse to show the mock-up's own panel over the score (mock-up only: the product has
  the control band of room-2d.md there). It jumps to moments (warm-up, zone 4, before a drop,
  before a song change, before an interval change, zone 7, a climb inside a song, jumps),
  switches states (running, paused,
  coasting, off the list, before the start, finished), speed (1 ×, 4 ×), reduced motion, quality,
  **Music detail** (full, no anchors, no moments, no tempo: the levels of "How much of the music
  is known"), **Worst case** (120-character cues and a countdown over 10 minutes), and **Sound**: a synthesised beat (kick, hats, a riser and a crash on the drop), so the light can
  be judged against something audible. Nothing is fetched.
- Keys: Space pause, arrows jump 15 s, `1` to `7` jump to that zone, `D` before the next drop,
  `S` before the next song change, `I` before the next interval change, `C` the next climb,
  `J` the next pattern, `B` music detail, `W` worst case, `M` reduced motion,
  `Q` quality, `A` sound, `H` hide the panel. The URL takes `?t=` (seconds), `state=`, `rm=1`,
  `q=`, `detail=` (`full`, `noanchors`, `nomoments`, `nobpm`) and `worst=1`, for screenshots.
- It is a reference for the look and the timing, not product code: PL6 builds the scene with its
  own model module, tests and screenshot checks.
