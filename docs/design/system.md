# Design system: stage light

Status: proposed in the pull request for issue #22. It sets the visual direction of plan
section 3 ("a light show, not a landscape", decision 7) for every screen, starting with the plain
2D room screen ([room-2d.md](room-2d.md)). The 3D scene's own look comes after spike 2 and must
use these tokens for everything it shares with the 2D screen: zone colours, type and the text
over the scene.

## The idea

The room screen is a dark stage with **one lit thing on it: the gel**. A gel is the coloured
filter in front of a stage light. On our screen it is a tall panel on the left, filled with the
planned zone's colour, with the zone number cut out of it in black at a third of the screen's
height and the zone's name under it. Everything else is white light on black: the countdown, the
cadence, the cue, and a **score** along the bottom that moves sideways under a fixed "now" line,
with the intervals above the songs, like a track in a music editor.

- **Calm when nothing changes.** Between interval changes nothing on the screen moves except the
  score, slowly, the countdown's digits and a small dot on the beat. No pulsing fills, no glow that breathes, no
  animation for its own sake.
- **Clear when something changes.** A new interval changes the one big area of colour on the
  screen. Pausing turns the stage lights down (the gel goes dark and the colour moves into the
  numeral). The end of the class turns the house lights up (the gel goes white). A problem with
  the music link shows as a white plate with black text in the top right corner; the only other
  white plate is the "Paused" label above the frozen countdown.
- **Colour is the plan, white is the machine.** Hue only ever means the planned zone (rule 7).
  States of the player, the music link and the controls are shown in white, grey and black, so
  a link problem can never be read as a zone.

Why this is not MOWL's look (plan sections 2 and 3, rule 6): no rings of any kind, no row of
class bars along the top, no grid or bars per rider, no owl, flames or game names. Our profile is
a moving score at the bottom with the songs under the intervals and a fixed "now" line; the zone
is a full-height panel, not a ring; the palette below is our own and runs from sky to
ultraviolet.

## Colour tokens

Reference values: [mockups/tokens.css](mockups/tokens.css). Black is real black: on a projector,
black is the lamp off, which is what a dark studio wants.

| Token | Value | Use |
|---|---|---|
| `--stage` | `#000000` | Background of every room screen |
| `--stage-raised` | `#17171c` | Song clips in the score, panels, buttons |
| `--stage-line` | `#3a3a42` | Rules, phrase ticks, outlines |
| `--light-1` | `#f6f4ef` | Numbers, the cue, the "now" line, alert plates |
| `--light-2` | `#bdbab2` | Secondary values (units, the next interval's cadence) |
| `--light-3` | `#9a978f` | Labels only |
| `--ink` | `#000000` | Text on a lit zone or on a white plate |

### Zone gels

| Zone | Token | Value | Gel name | Black on it | It on stage | It on "lights down" |
|---|---|---|---|---|---|---|
| 1 | `--zone-1` | `#6fa8ff` | sky | 8.7 : 1 | 8.7 : 1 | 8.2 : 1 |
| 2 | `--zone-2` | `#22d3c5` | teal | 11.2 : 1 | 11.2 : 1 | 10.5 : 1 |
| 3 | `--zone-3` | `#81b250` | grass | 8.4 : 1 | 8.4 : 1 | 7.9 : 1 |
| 4 | `--zone-4` | `#ffe626` | yellow | 16.6 : 1 | 16.6 : 1 | 15.3 : 1 |
| 5 | `--zone-5` | `#ff8940` | orange | 8.9 : 1 | 8.9 : 1 | 8.4 : 1 |
| 6 | `--zone-6` | `#ff6680` | coral | 7.5 : 1 | 7.5 : 1 | 7.1 : 1 |
| 7 | `--zone-7` | `#bb8cff` | ultraviolet | 8.3 : 1 | 8.3 : 1 | 7.9 : 1 |

"Lights down" is the zone mixed 6 % into black (the gel while paused or before the start).
Every pair is at least 7 : 1, so a zone can carry text either way round.

**Neighbours stay apart for colour-blind riders.** Zones 3, 4 and 5 were chosen so that
neighbouring zones differ in lightness as well as hue: yellow (L\* 91) is far lighter than
grass (L\* 67) and orange (L\* 69) on either side of it. The colour difference (CIE76 ΔE) between
neighbouring zones, simulated for full colour vision deficiency (Machado, Oliveira and
Fernandes 2009):

| Vision | 1–2 | 2–3 | 3–4 | 4–5 | 5–6 | 6–7 | Minimum required |
|---|---|---|---|---|---|---|---|
| Normal | 67.4 | 51.5 | 52.8 | 60.1 | 46.0 | 70.2 | 30 |
| Protanopia | 46.9 | 51.3 | 42.9 | 44.9 | 48.8 | 56.9 | 25 |
| Deuteranopia | 43.5 | 51.1 | 47.2 | 28.8 | 37.3 | 73.1 | 25 |
| Tritanopia | 17.0 | 32.6 | 37.7 | 49.3 | 14.2 | 66.9 | 12 |

The first palette (lime `#a8e05a`, amber `#ffc83d`) had 9.7 between zones 3 and 4 for
protanopia and 16.0 between 4 and 5 for deuteranopia. The minimums are checked by
[mockups/palette.js](mockups/palette.js) on `tokens.css` (with the contrast pairs above), and
any palette change, the 3D scene's included, must pass it. Colour is never the only cue in any
case: the number and the name are always on it.

Rules for zone colour:

1. A zone colour appears **only** on something that stands for that planned zone: the gel, the
   score's interval blocks, the "next" chip, the time-in-zone list. Never for a state, a warning,
   a button or decoration (rule 7). Measured heart rate never gets a zone colour (rule 7).
2. **Never colour alone.** Wherever a zone colour appears, its number is on it. Its name is next
   to it on the gel, in the "next" row and in the time-in-zone list; in the score the name is
   shown if and only if it fits whole (room-2d.md, check C5). Score blocks wholly in the past are
   grey, with neither colour nor number: they are history, not information.
3. The zone **names** and target ranges come from the class's `zone_scale` (ADR 0003); the
   colours come from the zone number and are the player's. The format carries no colour.
4. A class with more than seven zones is refused by the validator today; if a later format allows
   more, this table grows in a design pull request first.

Running classes (PL10) use zones 1 to 5 with the same colours.

## Type

Two families, both under the SIL Open Font License 1.1, committed with their licences in
[mockups/fonts/](mockups/fonts/). No font is fetched from the network.

| Family | Role | Why |
|---|---|---|
| **Big Shoulders Display** (600, 800) | Every number, the zone name, values | A condensed signage face made for being read from far away: tall figures in little width, so the countdown can be a third of the screen high and still fit beside the gel |
| **Atkinson Hyperlegible** (400, 700) | Cues, labels, song titles, anything a rider reads as a sentence | Drawn by the Braille Institute for legibility: letters that cannot be confused (I l 1, O 0) at a distance and through a cheap projector |

Big Shoulders' figures are proportional (a "1" is narrower than a "0"). The product sets each
digit of a running number (the countdown, class time) in a cell as wide as a "0", so a running
countdown does not shift sideways; the mock-ups, being static, do not. Labels are sentence case,
never all capitals. Text is never placed in an image.

### Type scale

Sizes are shares of the **screen height**, so a room screen reads the same at 720 or 1080 lines
and on any projector. Cap height is the measured height of a capital H in that face.

| Token | Font size | Face | Cap height (measured) | Use |
|---|---|---|---|---|
| `--t-gel` | 46 vh (31 vh at 4:3) | Big Shoulders 800 | 37.4 % (25.2 % at 4:3) | The zone numeral in the gel |
| `--t-hero` | at most 36 vh (28 vh at 4:3); smaller when the width needs it (room-2d.md, "Fitting text") | Big Shoulders 800 | 29.2 % at most; never under 20 % | Time left in the interval |
| `--t-value` | 8.4 vh (7.4 vh for the metrics at 4:3; 6.9 vh for a two-line zone name at 4:3) | Big Shoulders 800 | 6.8 % (5.9 %, 5.5 %) | Zone name, cadence, position, BPM |
| `--t-text` | 5.4 vh | Atkinson 700 | 3.6 % | The cue |
| `--t-text-min` | 4.6 vh | Atkinson 700 | 3.1 % | A long cue (over 70 characters) |
| `--t-minor` | 4.6 vh | Big Shoulders 600/800 | 3.7 % | Class time, next interval, targets |
| `--t-label` | 3.1 vh | Atkinson 400/700 | 2.1 % | Labels, link state, score text |

Nothing on a room screen is smaller than `--t-label`. Everything a rider acts on (the
countdown, the zone, cadence, position, the cue, the next interval) is at least 3 % cap height;
the 2 % tier is kept for labels, link states and the score's song titles.

## Space

- **Safe area:** 5 % of the width and of the height on every side (`--safe-x`, `--safe-y`).
  Projectors overscan and keystone; no text goes outside it. Colour fields (the gel, the score)
  may run to the edge.
- **Grid (16:9 and 16:10, anything wider than 3:2):** the gel is 27 % of the width; the content
  column starts at 31 %; the metrics column is 40 vh wide against the right safe edge; the score
  is the bottom 15.5 % above the safe edge, with "now" at 25 % of the width. At 3:2 and narrower
  (4:3, 5:4): the gel is 30 % wide and 60 % high, the metrics sit in a row under the countdown,
  and the cue and the next interval use the full width under the gel.
- Spacing steps are multiples of 0.6 vh; the base gap is 2 vh.

## Motion

| Token | Value | Where | With reduced motion |
|---|---|---|---|
| `--m-change` | 700 ms, ease out | The gel's colour at an interval change | 0: the new colour is there at once |
| `--m-flash` | 160 ms | A white line, 1 vh wide, down the gel's right edge at an interval change | 0: no flash |
| `--m-state` | 300 ms, ease out | A link-state plate appearing or leaving; lights down and up | 0 |
| (score) | continuous, 0.28 vw per second | The score moving under "now" | Moves in whole-second steps |
| (beat) | 120 ms | A dot beside the BPM, on the beat, only when the link is locked and the song has beat anchors | Off |

The single orchestrated moment is the interval change, and its white edge line is the one large
flash the screen makes, once per change. Apart from that line and the beat dot, nothing flashes,
and nothing flashes more than three times a second. The 3D scene may add its own light show, but
the text and the zone rules above stay as they are over it.

## Shipping the tokens

The product ships these values as **`web/src/design/tokens.css`** (the custom properties of
[mockups/tokens.css](mockups/tokens.css), copied unchanged), **`web/src/design/zones.ts`** (zone
number to token name, 1 to 7) and the four font files with their licences in
**`web/src/design/fonts/`**. The screens lane creates them in its first PL4 pull request; a
change to a value is a design pull request that edits this file and
[mockups/tokens.css](mockups/tokens.css) first. The 3D scene reads the same values from that
file or from a generated copy, never from its own table.
