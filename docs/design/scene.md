# Screen spec: the 3D room scene ("the rig")

Status: proposed for phase PL6 (plan sections 3 and 9). Scene technology: web 3D in the room
window (the spike 2 `web` variant), with the text as HTML over it. Design system:
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
   each visible ahead), and on **beat-counted position patterns** (class format 1.1,
   issue #469: `interval.pattern`, for example seated and standing for 8 beats each). The
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
6. What comes next: the next zone (number, name, colour), length, cadence, position.
7. **The score, now 8 minutes ahead** (owner input 1), **intervals first** (owner input 4):
   intervals with zone number, name, length, pattern and cue, so a climb of three intervals
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
nothing gives shape.** No beam angle, length, height or slope is taken from an interval's values.

| Source | Drives | Never drives |
|---|---|---|
| The planned zone of the interval | Colour of every light; **energy** (table below): brightness, how many fixtures are lit, how fast they move, how deep the beat lift is, how dense the haze glows | Any angle, height or shape |
| The song (its order in the class) | The **look**: the pattern the rig is aimed in (fan, cross, sweep, circle, split). The same class always gets the same looks | Colour |
| The beat (beat anchors, link locked) | A lift of every lit beam and a step of the wall's chase, at most 3 a second | Movement speed |
| The phrase (every 8 bars from the anchors) | The look's variation: mirrored, chase direction, which half leads | |
| A song change | The rig dims for one beat and re-aims to the new song's look in 1.2 s | |
| Moments (`build`, `drop`, `breakdown`) | Build: the 8 beats before a drop (or the `build` moment) gather every beam to one point, the haze brightens, the lift deepens. Drop: one white burst, then every fixture on and fanned wide for 4 bars. Breakdown: one slow beam and the wall, for 8 bars | |
| The next interval | **Anticipation**: in the last 10 s before an interval change the back truss and the LED wall turn to the next zone's colour, as a wipe from the far side; the front truss changes at the change | |
| A position pattern (format 1.1, link locked) | **Energy only**: the beams at full brightness on the "up" side and at 72 % on the "down" side, and a 25 % accent on the first beat of each side. At most one accent per side, so at most 3 a second | Any angle, height or shape (the rig does not "stand up") |
| Link state | Without a lock, no beat at all (as the 2D beat dot); see the states | |

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
| Zone   | 23:41 left  18:19 done                Main set  * Following     |
|  4     |                                                  Interval left  |
|        | Cadence        ~ beams, haze, wall ~                             |
|        | 90-100 rpm                                       1:10           |
|        | Position                                                        |
|        | Seated                                     37 bars to the change|
|Thresh. | Song                          Next [2] Endurance 0:45 85-95 Seated|
|88-94%  | 128 bpm *                                                       |
|RPE 7-8 | Find the beat and hold it. Breathe out on every second bar.     |
+--------+-----------------------------------------------------------------+
| //|4 Threshold 1:10 |2 Endurance 0:45|5 VO2 max 3:00      |3 Tempo 2:00 ..|  intervals
| //|Find the beat... |Spin it out     |Climb out of the... |Hold 90 ...    |  their cues
| //|Neon Avenue      |Pulse Theory  Aurora Lane 132 bpm | Drop            |  songs
|   ^ now (10 vw)                                         8 minutes ahead  |
+--------------------------------------------------------------------------+
```

| Region | Box | Content |
|---|---|---|
| Gel plate | 0, 0, 24 vw, 66 vh; opaque zone colour | "Zone" label, numeral (32 vh, Big Shoulders 800, ink), name (at most min(7.6 vh, 4.4 vw), two lines), targets (`--t-minor`) |
| Rail | 27 vw, 5 vh, to 95 vw | Class time left and done, segment, link state (as room-2d.md) |
| Metrics | 27 vw, 12 vh, 22 vw wide, stacked | Cadence, position, BPM: label `--t-label`, value 7.6 vh (Big Shoulders 800), unit `--t-minor` |
| Clock | right-aligned to 95 vw, label at 11 vh | Label, countdown (30 vh, at least 25 vh, see "Fitting"), bars line (`--t-minor`) |
| Pattern | 50 vw, 11 vh, to the clock's left edge; only in an interval with a pattern | See "Intervals first: climbs and patterns" |
| Next | right-aligned to 95 vw, under the bars line | "Next", zone chip, name, length, cadence, position or pattern ("8 up, 8 down") (`--t-minor`); two lines at most |
| Cue | 27 vw to 95 vw, ends by 66 vh | `--t-text`, two lines; over 60 characters `--t-text-min`, three lines |
| Score | 0, 68 vh, full width, to the bottom | See "The score" |
| Stage | everything else | The rig at full brightness |

### 4:3 and narrower (3:2 and narrower)

The gel plate is 30 vw by 50 vh (numeral 28 vh); the clock sits right of it with its label at
9 vh and the countdown at 25 vh (cap height 20.3 %, still above S1). The metrics become one row
from 41 vh, values min(7.4 vh, 5.5 vw); the next row runs from 5 vw at 53 vh, the cue from 5 vw at
58.5 vh to 95 vw (`--t-text-min`, two lines at most, ending by 72 vh), and the score starts at
74 vh with its lanes compressed (interval blocks 9.4 vh) and **6 minutes ahead**. In an interval
with a pattern there is no room for the pattern block: the Position metric becomes the side and
the count (count at 1.8 × the metric value, at least 13 vh at 4:3), the metrics row moves up to
36 vh and the bars line is left out (the beat count replaces it).

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
  narrower; never under 5 minutes at any supported size. "Now" is a fixed white line at 10 vw.
  It moves continuously (0.19 vw a second at 16:9), whole-second steps with reduced motion.
- **Interval lane** (68 to 80 vh): each block is the zone colour with, in ink, its number
  (5 vh, Big Shoulders 800), its name and its length (`--t-label`, 700) on the first line, and
  its **cue** on the second (`--t-label`), ending in an ellipsis at the block's end. The number
  is always there for a block at least 2.5 vw wide; the name and the length only when each fits
  whole; the cue when at least 6 vw is left. A 45 s interval is 8 vw wide at 16:9. Blocks wholly
  in the past are grey with nothing on them; a current block keeps its labels just right of "now".
- **Song lane** (81 to 90 vh): clips in `--stage-raised` with title, then artist and BPM when
  they fit; a moment is a white tick with its word ("Drop", "Build", "Breakdown") under the title.
- **Phrase ticks** every 4 bars along the song lane's foot, as room-2d.md.
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
- **A position pattern** (format 1.1, issue #469): `interval.pattern` alternates positions on
  the song's beat, for example `{"kind": "alternate", "positions": ["standing", "seated"],
  "beats": [8, 8]}`. It replaces `position` for that interval. The count starts on the first beat
  at or after the interval's start (`start_on`), from the beat anchors, else from `bpm` alone.
  The words on screen are **UP** (standing) and **DOWN** (seated).

**Pattern block** (16:9; at 3:2 and narrower it is folded into the Position metric, see
Layout), top to bottom, all text in `--light-1` unless said:

| Line | Content | Size |
|---|---|---|
| Label | The pattern as words: "8 up, 8 down" | `--t-label` (`--light-2`) |
| Side | **UP** or **DOWN**, the side the room is on now | 9 vh, Big Shoulders 800, capitals (cap 7.3 %) |
| Count | Beats left on this side, **8 … 1**, stepping on each beat | 22 vh, Big Shoulders 800 (cap 17.9 %) |
| Beats | One square per beat of this side (only for 8 beats or fewer): filled for the beats left, outlined for those done; then "then down" or "then up" | squares 1.6 vh; `--t-label` (`--light-2`) |

The Position metric shows "Up / down" while the block runs. The bars line under the countdown
stays (it counts to the interval change, the block counts to the next switch).

- **Without a beat lock** (coasting, off the list, manual clock, hold): the count and the side
  are **never guessed**. The block keeps its label and says "count from the music"; the
  instructor counts from what the room hears. The rig drops the pattern accent with the beat.
- **In the score**: a block with a pattern starts its second line with the pattern in bold
  ("8 up, 8 down · Jumps on the drop…") and carries a 1 vh strip along its foot, dark on the
  "up" beats and clear on the "down" beats, on the song's beat grid, so the rhythm of an
  upcoming pattern is visible minutes ahead. The **next row** names it the same way.
- **Reduced motion**: the count still steps with the beat (it is information, not decoration);
  nothing else moves.

The plain 2D screen gets the same block and fold (room-2d.md follows in its own pull request,
after #469 merges), so a fallback never loses the count.

## Text over light: the dark-under-text rule

Text is HTML over the scene, never in the picture. The scene keeps the haze **dark under text**:
inside every text line's box, grown by 1.2 vh and faded out over a further 2 vh, the scene's
relative luminance is capped at **0.08** (the mock-up uses 0.075 as a margin). White `--light-1` text (0.905) is then at least
**7.3 : 1** against the worst scene pixel under it, every frame, whatever the rig does. The
light still shows there, dimmed and in colour, so the room stays the zone's colour behind the
numbers; it reads as the text standing in the haze's shadow. The gel plate and the score are
opaque and are checked as in room-2d.md.

Zone colours appear as text only on opaque fills (the gel, the score, the next chip), never
straight on the scene.

## States

| State | Rig | Text layer |
|---|---|---|
| Before the start | House look: lights down to 6 % in the first zone's colour, two slow beams, the wall dark, no beat | As room-2d.md "Before the start" (gel lights down, class title, time in each zone) |
| Warm-up (zones 1 and 2) | Calm: few beams, slow sweep, a slow wave on the wall, shallow lift on the beat; the haze clearly blue or teal | Running layout |
| Each zone, 1 to 7 | Colour and energy from the table above | Running layout |
| Interval change coming (last 10 s) | Back truss and wall wipe to the next zone's colour from the far side; the front truss stays | Label "Change in" in the last 5 s (room-2d.md); the next row is the next zone with its number and name, so the second colour on screen always has its number beside it |
| Interval change | Front truss crosses to the new colour in 700 ms (`--m-change`); every lens flashes white once (160 ms, `--m-flash`); the gel crosses as in 2D | New values; one white line down the gel's edge |
| Song change | Rig dims to 25 % for one beat, re-aims to the new song's look over 1.2 s, back on the first beat of the new song | Score moves on; song clip and BPM change |
| Build (8 beats before a drop, or a `build` moment) | Beams gather to one point in the middle of the room, the haze brightens to 1.5 ×, the lift deepens to 55 % | Nothing new (the score shows the "Drop" tick) |
| Drop | One white burst over the whole scene (peak at 0.85 of white, 250 ms decay; the only full-screen flash), then every fixture on and fanned wide for 4 bars, then the zone's own energy | Unchanged; the text is never flashed (dark-under-text holds during the burst) |
| Breakdown | One slow beam on the front truss and the wall's wave for 8 bars | Unchanged |
| Paused | Lights down: everything to 6 %, frozen where it was | As 2D: gel lights down, "Paused" plate, link plate "Music paused" |
| Coasting (readings stopped or stale) | No beat at all (the beat cannot be measured); the rig keeps the zone's colour and moves at its energy | As 2D: "estimated", dimmed dashed countdown, link plate "Music not heard" |
| Off the list | "Holding" look: no beat, movement halved, brightness 60 %, the song look of the interval's planned song | As 2D: link plate "Not a class song", BPM "Song, planned" |
| Position pattern, locked | The zone's look, beams at full on "up" and 72 % on "down", an accent on each switch | Pattern block: side, beat count, beat squares, "then …" |
| Position pattern, no lock | No beat, no pattern accent | Pattern block: label and "count from the music"; no side, no count |
| Ambiguous, manual clock, hold at a song change | Ambiguous as running; manual clock and hold: no beat, movement at the zone's energy | As 2D |
| Last interval | As its zone | As 2D ("End" mark in the score) |
| Finished | House lights up: the rig white and still, at 40 %; the wall white | As 2D "Class Complete" (white gel) |
| Scene killed or too slow | The plain 2D screen within 2 s, in the clock's state, no start-up animation (plan section 9) | Identical text, so nothing jumps |

## Motion and reduced motion

- **Limits, always:** nothing lifts, steps or flashes more than **3 times a second** (above
  180 BPM the lift is on every second beat, as the 2D beat dot); a beam turns at most 30 degrees
  a second; the white drop burst is the only full-screen flash, at most once per drop moment and
  never within 10 s of another; the lens flash at an interval change is the other orchestrated
  moment. The beat lift is a brightness change of at most 45 % (55 % in a build) on the beams
  only, never on the gel or the text.
- **Reduced motion** (the system setting or the player's own): the room shows the **plain 2D
  screen** (plan section 3: plain mode is for reduced motion). Where the scene is shown anyway
  (the presenter preview, CI's reduced screenshots), it is the **still rig**: the song's look
  frozen, no beat lift, no sweep, no wall chase, no burst, no lens flash, colour changes instant,
  anticipation shown as an instant change of the back truss's colour, the score in whole-second
  steps. No state relies on motion to be understood.

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
| S1. Text height (cap height / screen height) | Countdown at least **20 %**; zone numeral at least **20 %** (24 % at 16:9 nominal); metric values, zone name and pattern side at least **5.5 %**; the pattern's beat count at least **10 %** (17.9 % at 16:9); the cue, class time and next row at least **3 %**; labels, link state and score text at least **2 %**. As C1, measured in the product's own browser |
| S2. Contrast | Text against the worst pixel under its ink, over a sequence of at least 120 frames covering a beat, a build, a drop and an interval change: at least **7 : 1** (4.5 : 1 for labels). The scene's relative luminance inside each text box (grown by 1.2 vh) is at most **0.08** on every frame |
| S3. Look-ahead | The score shows at least **5 minutes** ahead of "now" at every supported size (**8** at 16:9 and wider, **6** at 3:2 and narrower). Every interval starting within the window and at least 2.5 vw wide shows its zone number; the next interval's number, name, length and cue are always readable (in the score or the next row) |
| S4. Visible at once | All nine content items in every running state, with the band hidden, at every supported size |
| S5. Zone | The zone is a number and a name as well as a colour on the gel, the next row and the score (as C5). The rig shows only the current zone's colour, the next zone's colour during the 10 s anticipation (while its number and name are in the next row), and white. Never another hue, never a measured heart-rate zone (rule 7) |
| S6. Flashes | No region larger than 10 % of the screen changes in relative luminance by more than 10 % more than 3 times in any second. One full-screen burst per drop moment, at least 10 s apart |
| S7. Movement | The camera never moves. No beam turns faster than 30 degrees a second. No geometry takes a value from an interval (rule 4): a test drives two classes that differ only in their intervals' targets and checks every beam's direction is identical frame for frame |
| S8. Beat | The beat lift happens only when the link is locked and the song has beat anchors; within 50 ms of the anchor beat (spike 1's criterion); none while paused, coasting, off the list, on the manual clock or holding |
| S9. Frame rate | At least 50 fps at High on the reference studio computer at 1920 × 1080; the quality steps of the table above, measured by the frame log |
| S10. Fallback | Scene killed: the plain 2D screen within 2 s, the clock continuous (plan section 9) |
| S11. Reduced motion | With reduced motion the room shows the plain screen; a still-rig screenshot shows no change between two frames 1 s apart except the score's one-second step and the countdown |
| S12. Hue in the text layer | As C6: hue only on elements that stand for a zone |
| S13. Intervals first | Every interval is its own block in the score: a test class with three intervals inside one song shows three blocks, each with its number, in the look-ahead window. A song clip never hides, merges or reorders interval blocks |
| S14. Pattern count | In an interval with a pattern and a lock, the side and the count are on screen at all times; the count steps within **50 ms** of the anchor beat (as S8) and reaches the next side exactly on the switch beat; the next side is named. With no lock, no side and no count is shown. Every pattern starting in the look-ahead window shows its words in the score or the next row |

## Tokens

The scene reads the zone colours and type from `web/src/design/tokens.css` (system.md, "Shipping
the tokens"), never from its own table. Scene-only values, added to tokens.css by PL6's first
pull request:

| Token | Value | Use |
|---|---|---|
| `--scene-text-cap` | 0.08 | Highest relative luminance of the scene under text |
| `--scene-text-pad` | 1.2 vh, fade 2 vh | Growth of each text box for the cap |
| `--scene-down` | 0.06 | Lights down (paused, before the start), as the 2D gel |
| `--scene-house` | 0.40 | House lights (finished), white |
| `--scene-burst` | 0.85, 250 ms | The drop burst's peak share of white and its decay |
| `--scene-anticipate` | 10 s | How long before an interval change the next colour comes in |
| `--scene-reaim` | 1.2 s | A song change's re-aim |
| `--scene-lift-max` | 3 per second | The beat lift's highest rate |
| `--score-ahead` | 8 min (6 at 3:2 and narrower) | The score's look-ahead |
| `--score-now` | 10 vw | Where "now" is |
| `--pattern-count` | 22 vh (16:9) | The pattern's beat count |
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
| 4. No road, track, terrain or world | No ground, horizon or path; nothing travelled along; no geometry from an interval (S7). The score is flat |
| 5. No moving viewpoint | The camera is fixed |
| 6. None of MOWL's look | No rings, no row of class bars on top, no rider grid or bars, no flames; our palette; the rig is a stage, not their world |
| 7. Colour is the planned zone | S5; link states are white plates as in 2D |
| 8 to 12 | No hand icons, no heart-rate advice, our own load names, cues as written, nothing generated, no camera |
| 13 to 15 | No rider data on the room screen at all |

## The mock-up

[mockups/scene-rig.html](mockups/scene-rig.html): one file, no library and no network (plain
WebGL and the repository's own fonts and tokens next to it). It plays a fake 24-minute class
(six songs and twenty intervals: two climbs of three steps inside a song, two "8 up, 8 down"
patterns and one "4 up, 4 down", zones 1 to 7, four drops, a build, a breakdown) on a simulated
clock. Open it in Chromium, Edge, Firefox or Safari, full screen (F11 or
Ctrl+Cmd+F), ideally on the studio projector in the dark.

- Move the mouse to show the mock-up's own panel over the score (mock-up only: the product has
  the control band of room-2d.md there). It jumps to moments (warm-up, zone 4, before a drop,
  before a song change, before an interval change, zone 7, a climb inside a song, jumps),
  switches states (running, paused,
  coasting, off the list, before the start, finished), speed (1 ×, 4 ×), reduced motion, quality,
  and **Sound**: a synthesised beat (kick, hats, a riser and a crash on the drop), so the light can
  be judged against something audible. Nothing is fetched.
- Keys: Space pause, arrows jump 15 s, `1` to `7` jump to that zone, `D` before the next drop,
  `S` before the next song change, `I` before the next interval change, `C` the next climb,
  `J` the next pattern, `M` reduced motion,
  `Q` quality, `A` sound, `H` hide the panel.
- It is a reference for the look and the timing, not product code: PL6 builds the scene with its
  own model module, tests and screenshot checks.
