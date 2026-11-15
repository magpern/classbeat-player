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
| The beat (see "How much of the music is known") | A lift of the rig and a step of the wall's chase, at most 3 a second (to be built in #577: a lift of every light of the rig by the same share, 1.5 to 4.5 % by zone, each run at most 5 %, "The flash budget"; as built, a lift of every lit beam by 15 to 45 %) | Movement speed |
| The phrase (every 8 bars from the anchors) | The look's variation: mirrored, chase direction, which half leads | |
| A song change | The rig dims for one beat (when the flash budget has room, to be built in #577) and turns to the new song's look at the turn limit (next section): at most 3.5 s, never faster than 30 degrees a second | |
| Moments (`build`, `drop`, `breakdown`) | Build: the 8 beats before a drop (or the `build` moment) gather every beam to one point and the haze brightens (to be built in #577: a step up on each beat, about 1.25 ×; as built, 1.5 × and a deeper lift). Drop: one white burst, then every fixture on and fanned wide for 4 bars. Breakdown: one slow beam and the wall, for 8 bars | |
| No moments in the song | Bursts follow the interval changes inside the song (plan section 4), at least 10 s apart from any burst (to be built in #577; as built, from each other): **light only**, no gather and no fan, so no direction follows an interval's timing | Any angle |
| The next interval | **Anticipation**: in the last 10 s before an interval change the back truss and the LED wall turn to the next zone's colour, as a wipe from the far side, at constant luminance; the front truss, the floor uplights and the haze cross in the 700 ms that **end** at the change ("Colour: two hues, never a mix") | |
| A position pattern (format 1.1, beat known) | **Energy only**: the beams at full brightness on the "up" side and at 72 % on the "down" side, and an accent on the first beat of each side. To be built in #577: the step is one frame on the switch beat's count tick, and the accent is 5 %, **in place of** that beat's lift, never added to it ("The flash budget"); as built, a 25 % accent. At most one accent per side, so at most 3 a second | Any angle, height or shape (the rig does not "stand up") |
| Link state | Without a lock, no beat and no tempo pulse (as the 2D beat dot); see the states | |

### How much of the music is known

Plan section 4 and ADR 0003 section 5 set what the scene may do with what the class file gives.
Nothing beat-like is ever guessed: a downbeat that is not known is not drawn.

| Level | When | What runs |
|---|---|---|
| **Beat** | Link locked, the song has `bpm` and `beat_anchors` | Everything: beat lift, wall chase, phrase mirroring, the bars line, the pattern count (both `start_on` values), the pattern accent |
| **Tempo only** | Link locked, `bpm` but no anchors | A shallow **tempo pulse** of the rig (4 %, to be built in #577, 12 % of the lit beams as built; its own phase, not claimed to be on the beat); no wall chase, no phrase, no bars line, no pattern accent. The pattern count runs only for `start_on: "interval_start"` (the default), counted at the bpm from the interval's start; a `next_downbeat` pattern shows "count from the music" |
| **None** | No lock (coasting, off the list, paused, manual clock, hold), or the song has no `bpm` (`pattern_without_bpm`, ADR 0003) | No lift, no pulse, no accent, no count; the zone's colour and energy and the motion stay |

Moments are independent: a song without marked moments gets bursts on its interval changes
(table above); a song with them never also bursts on an interval change.

**Moments at the None level (decided, #526 review).** A marked moment is a fact about the song's
timeline (`at_ms`), not a beat the player has heard, and its window is counted at the song's
`bpm` from that timeline. So the gather, the fan and the breakdown run at **every** beat level,
including None, as long as the song has a `bpm` and the class clock gives a song position
(Locked, Coasting, Ambiguous, manual clock). S8 forbids only beat-like effects (lift, pulse,
chase, accent, phrase) without a lock, and a gather or a fan is none of them. Three limits:

- **No `bpm`, no window.** The windows are counted in beats; a song with no `bpm` has no gather,
  no fan and no breakdown, whatever its marked moments. Nothing is guessed.
- **Frozen states do not move them.** Paused and a hold freeze the rig where it was, so the
  moments freeze with it.
- **Off the list has none.** The music is not the planned song, so its position says nothing
  about the planned song's moments: the "Holding" look has no gather, no fan, no breakdown, no
  drop burst and **no light-only burst on an interval change** either.
- **The drop's white burst also shows at the None level**, with the gather and the fan, except
  while paused, holding or off the list. It is light, not a beat. To be built in #577: without
  the beat the flash budget has no room for a burst's two changes beside the countdown's tick, so
  at the None level the drop is **the fan's frame** (every fixture on in one frame, no burst;
  "The flash budget").
- **Where this is gated.** The model's `sceneFrame` must gate the moments by link state (none
  when Paused, held or Off the list), with a test; today it computes them in every state. That is
  a scene-lane change after this PR, not part of it, and not left to the renderer.

### How a beam turns (decided, #526 review)

**S7's 30 degrees a second is absolute and always holds, on every rendered frame.** It is the
speed of the beam's rendered direction, measured as the angle between its direction on two
consecutive frames divided by the time between them, pan and tilt together. It has no
exception for a re-aim, a phrase boundary, a moment or a look change, and no product rule or
S-criterion is relaxed to make room for them.

The model's `directions` are therefore **targets**, not what is drawn. Several of them change in
a step: the phrase boundary mirrors every pan (a 104 degree pan step on the fan's edge fixture,
102 degrees of turn), the lead half is 60 degrees of phase ahead (up to 31 degrees of turn),
gather and fan switch on and off (up to 105 degrees; 83 into a gather), and a song change
brings a new look (up to 79 degrees in the same phrase, but a new song starts on the first phrase,
so from a mirrored phrase the step is about 102 degrees; leaving the Beat level mid-phrase, which
un-mirrors, gives the same). Measured on the model at 2a129c7, the
largest step between any two targets of one fixture is 104.7 degrees. The renderer draws each
beam with a **turn-rate limiter**:

1. Each frame, a beam's drawn direction moves toward its target along the shortest turn by at
   most 30 degrees a second times the frame time. It never overshoots and never waits: it
   starts turning on the frame the target changes.
2. **A re-aim takes as long as its turn needs.** The longest turn, 104.7 degrees, takes 3.5 s,
   so a song change, a phrase flip, a gather or a fan **completes within 3.5 s** and most take
   less. The "1.2 s" of the earlier text is gone and names nothing now: the dim is one beat
   long, and no colour belongs to a look (the zone alone gives colour, rule 7). The look
   ranges are not shrunk to fit 1.2 s; that would flatten every look to under 36 degrees.
3. The frame time used is at most 100 ms, so a stalled frame or a tab brought back to the front
   never makes a beam jump. A frame over 100 ms turns the beam by at most 3 degrees.
4. Nothing turns in the first frame of the scene (the beams start on their targets), and nothing
   turns while the rig is frozen (Paused, hold, the still rig).
5. **Beat words.** The only targets that change on a beat are the phrase mirror and the
   lead-half swap (S8, Beat level only): the **target** changes within 50 ms of the anchor beat
   and the beam starts turning on that frame; its arrival may be later, up to 3.5 s. A position
   pattern never changes a target (rule 4, "What drives what"): its accent on the first beat of
   a side is **brightness only**, is not turn-limited, lands within 50 ms of the beat, and is
   carried by the lift and the wall's chase. A beam never "arrives on the beat".
6. **A gather may arrive late.** The gather is the 8 beats before a drop. A gather turn of up to
   83 degrees takes 2.8 s, which fits 8 beats up to about 170 bpm; above that the beams are
   gathered only as far as the limit allows when the drop's burst comes, and then fan. This is
   accepted: the limit is not relaxed for it, and the burst, not the gather, is the event.
7. **Rule 4 holds.** The limiter's state is the drawn direction and its input is the target,
   whose inputs are the five of "What drives what". No interval, zone, target, position,
   pattern or cue reaches it, and its only other input is the frame time.

**What the renderer must do and how it is tested.** The limiter is a pure function in the scene
model, `limitTurn(drawn, target, maxDegrees)`, a later scene-lane issue (the renderer calls it
once per beam per frame). Tests, all in the scene model's own suite, which runs with no
renderer:

- **Unit:** for any drawn direction and target, and frame times from 4 ms to 100 ms, one step
  turns by at most 30 degrees times the frame time (plus 0.01 degrees of rounding), never
  overshoots, reaches the target in the fewest steps, and does nothing when already there.
- **Worst-case drive:** for each fixture, drive the model through every step of S7's list (a
  phrase flip, a look change, the gather and the fan switching on and off, each from the
  worst phase of the motion) at 30, 60 and 144 frames a second. On every frame the angle
  between the drawn directions of two consecutive frames, over the frame time, is at most 30
  degrees a second, and every drawn direction is at its target within 3.5 s plus one frame (the bound is tight:
  the worst case, a fan to a cross on the back truss, arrives at 3.49 s before rounding up to
  whole frames). The drive also includes stalled frames of 250 ms and 1 s, which the clamp of
  item 3 turns into 100 ms: a stalled frame turns a beam by at most 3 degrees. (The clamp is the
  caller's, so the drive tests the renderer's loop and not `limitTurn` alone.)
- **Both together** with the existing rule-4 test: two classes that differ only in intervals
  give identical drawn directions on every frame, not only identical targets. The test feeds both
  classes the same sequence of motion phases and frame times: the phase's rate comes from the
  zone, so a time-driven run would differ, and the zone is not taken out of the rate to make it
  pass.
- **In CI's scene screenshots run:** the frame log (S9) also records the highest beam speed of
  each second; the run fails above 30 degrees a second (with 2 percent for timing). The run plays through a
  phrase flip, a song change (from a mirrored phrase) and a build with its drop, so the gather
  and the fan are in the log; without those transitions the check measures nothing.

### Values the scene model fixed (as built, #526)

This spec left some values open. The pure scene model, `player/scene/model/`, fixed them; they
are accepted as the spec's values. **The source is the code**: if a number here and the code
differ, the code in [looks.ts](../../player/scene/model/src/looks.ts),
[beams.ts](../../player/scene/model/src/beams.ts),
[moments.ts](../../player/scene/model/src/moments.ts) and
[beat-grid.ts](../../player/scene/model/src/beat-grid.ts) wins and this table is corrected in
the next design pull request. All angles in degrees, pan to the right, tilt down from the
horizontal.

| What | Value |
|---|---|
| Fixtures | 22: front truss 8, floor uplights 6, back truss 8. Resting tilt: front 35, floor -60 (rises), back 10 |
| Looks | By the song's order in the class, modulo 5: fan, cross, sweep, circle, split. Neighbouring songs never share a look |
| Fan | Pan from -40 (left end) to +40 (right end) by fixture, plus a 12 sway; tilt at rest. Cross: the same, left and right swapped |
| Sweep | All fixtures pan with an amplitude of 30; tilt amplitude 6 |
| Circle | Pan amplitude 25, tilt amplitude 12 |
| Split | The two halves apart: pan 15 to 40 out from the middle, plus the 12 sway |
| Gather (build) | Pan -30 to +30 across the fixtures, crossed, so the beams meet at one point; tilt 15 higher than at rest |
| Fan wide (drop) | Pan -55 to +55 by fixture; tilt at rest |
| Phrase | 8 bars, a bar is **4 beats**, so 32 beats. Odd phrases mirror every pan; the half of the fixtures that leads is 60 degrees of phase ahead and changes every 2 phrases |
| Moment windows | Build: 8 beats (before a drop, or from a `build` moment). Drop fan: 16 beats (4 bars). Breakdown: 32 beats (8 bars). A gather wins over a fan. All counted at the song's `bpm`; **no `bpm`, no window** |
| Without anchors | No phrase: the first phrase, never mirrored |

The largest pan any look or moment reaches is 55 (the wide fan). These are **targets**; what is
drawn is limited to 30 degrees a second by "How a beam turns".

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

The "Beat lift" column is the lift **as built today** (15 to 45 %, 55 % in a build), and a test
holds the code to this table. Measured strictly, a lift and its fall are two changes in every
region a lit beam crosses, so at 120 bpm the beat alone made 5 changes a second (#569). **To be
built in #577:** the lift goes **under the flash threshold** in every region, 1.5, 2.0, 2.5,
3.0, 3.5, 4.0 and 4.5 % for zones 1 to 7, on every light of the rig (2 % in a build, with the
haze's step; "The flash budget"), and #577 puts these values in this column together with the
code: the energy of a zone shows in how many fixtures are lit, how bright and how fast they are
and how dense the haze is, and the beat is a breath on top, not a flash.

### Colour: two hues, never a mix (S5, decided, #569 review)

**To be built in #576** (the linear-light renderer and the cross). Until then the renderer
blends the two tokens and does not meet this section.

A straight mix of two zone tokens is a third hue (sky into teal gives a blue-cyan that is
neither; ultraviolet into grass a lavender grey). So the rig never mixes two tokens: not in a
light, not where two lights overlap, not in a cross.

**What a pixel may be.** In linear light, every pixel of the rig is

`a × T + w × (1, 1, 1)`, with `a ≥ 0` and `w ≥ 0`,

where `T` is one zone token: the current zone's, or the next zone's from the start of the
anticipation until the change. White is equal red, green and blue in linear light (the burst,
the lens flash, the finished house look). So a token **keeps its hue at any lightness and with
any share of white**: darkened by distance, thinned by haze, cut by the text cap, washed by the
burst, it is still the same token. Anything else is a third hue: a mix of two tokens, a hue
shifted by a per-channel curve, or a layer added after the sRGB encoding (a sum of encoded
values is not a scaled token).

**How the rig keeps it.**

1. **One token per light.** Every source (a fixture's beam, its lens, a wall dot, the haze's
   ambient glow at a pixel) carries exactly one token, or white, at any moment. A source changes
   token by a **switch** in one frame, never a blend.
2. **A switch keeps the light's luminance.** At the switch the source's intensity is scaled by
   `Y(old token) / Y(new token)`, so its relative luminance does not move: only its hue does. A
   hue hand-over is therefore never a change in S6's sense. The energy of the new zone arrives
   separately, by the ramp below.
3. **Overlap by ownership, not by sum.** Where lights of the two tokens overlap (a front beam
   over the back truss during the anticipation), each pixel adds up luminance per token, `Yc`
   for the current and `Yn` for the next, and white `Yw`. The token with the larger share owns
   the pixel (a tie goes to the current): its colour is `T_owner` scaled to luminance `Yc + Yn`,
   plus `Yw` as white. The other token's light is not lost, it is shown in the owner's hue, so
   an ownership edge moves no luminance. A beam in front takes the colour where it is brighter.
4. **Linear light to the end.** Every layer (beams, lenses, haze, wall, burst, the text cap) is
   added in linear light, then tone-mapped, then encoded to sRGB **once**, as the last step.
5. **Hue-preserving tone map.** The curve acts on luminance and scales the colour (in the
   mock-up `L' = 1 - exp(-1.3 L)`); a channel that would pass 1 is brought back by moving the
   pixel toward white at the same luminance. Never a curve applied per channel.
6. **No filter blends two hues.** Every filter that averages pixels (the scale-up from the
   quality level's render scale of 0.75, 0.5 or 0.35, multisampling, FXAA or any other
   anti-aliasing, bloom, blur) runs on the luminance channels (`Yc`, `Yn`, `Yw`) **before** the
   resolve of rule 3, never on colour: averaged colour mixes the two tokens along every ownership
   edge. The owner is then chosen at the window's resolution. The one exception is a scale-up
   that only repeats pixels (nearest-neighbour, the mock-up's way; the soft light hides the
   steps), which averages nothing.

**The cross at an interval change.** It **lands on the change**: it runs in the 700 ms that end
at the change `t0`, while the next zone is still the next (its number and name are in the next
row), so the zone left behind is never on screen after the change.

| What | How |
|---|---|
| Direction | From the far side (screen right) toward the gel (screen left), as the anticipation's wipe |
| The front | A vertical line at `x(t) = 1 - e(s)`, with `x` the share of the screen's width from the left, `s = (t - (t0 - 700 ms)) / 700 ms` and `e` the ease-out of `--m-change`. It enters at the right edge at `t0 - 700 ms` and leaves the left edge at `t0` |
| Fixtures | The front truss and the floor uplights switch, beam and lens together, when the front passes the screen position of their lens (a lens off screen counts as the nearest edge). The back truss and the wall are on the next colour already, from the anticipation |
| Haze and ambient glow | Each pixel switches when the front passes it: a hard edge in hue only, at constant luminance |
| Energy | **One ramp** over the same 700 ms, linear, when the flash budget has room (with a count running, or without the beat, the energy is in the change frame at `t0` instead): every light's luminance goes from its old zone's value to its new zone's value along the same curve (a fixture coming on starts from 0, one going out ends at 0; the first side of a pattern is in the new value). Every region therefore changes in one direction only, one change at most. The hue switches add nothing (rule 2 above) |
| The gel | On the scene the gel **cuts** to the new colour at `t0`, in one frame, as the front leaves the left edge: the light arrives at the gel and the gel changes. It never shows a mix |
| Lens flash | Starting on the change frame at `t0`, after the cross (see "The flash budget" for its size); none with a burst |
| Short intervals | If the previous change is less than 700 ms before `t0`, the cross starts at that change and is shortened; it never starts earlier |
| A seek, a jump, a frozen rig | No cross: every light is on the zone of the new position in one frame |
| Combined with a burst or a dim | The hue cross runs as above. A burst on the change carries the energy in its decay; a song-change dim within 1 s is left out ("The flash budget", collisions) |

**The anticipation** uses the same switch: the back truss and the wall dots change token as the
anticipation's wipe passes them, at constant luminance, so the anticipation makes no change in
S6's sense. It starts at the later of `t0 - 10 s` and the previous change, so in an interval
shorter than 10 s it is shortened and the screen still holds only two tokens.

**Reduced motion** (the still rig): no front and no ramp. At `t0` every light takes the new token
and the new zone's energy in one frame; the anticipation is one frame at the later of `t0 - 10 s` and the
previous change for the back truss and the wall; the gel cuts at `t0`.

**The test (S5), on rendered pixels, never on shader inputs.** On every frame of the S6 runs
(below), in every state, read the rig's canvas as shown at the window's size (the text layer is
not part of it; C6 and S12 hold it), decode to linear light, and for each pixel fit
`a × T + w × (1, 1, 1)` with `a, w ≥ 0` (least squares) for each token allowed on that frame.
The pixel passes when, for one allowed token, the fit encoded back to 8-bit sRGB is within
**1 code value on every channel** of the pixel. Allowed: the current zone's token on every frame;
the next zone's token only from the start of the anticipation until `t0`. Required: **0 failing
pixels** in every frame.

What the check can and cannot see: the closest pair of tokens, zones 5 and 6, is 13 degrees
apart in linear chroma, and their half mix is 6.7 degrees from either, which the fit sees in a
lit pixel. It cannot see everything: a mix of two **complementary** tokens lies near the white
axis, so it is within one code of a desaturated token at most mix ratios even when bright (zones
1 and 4 at 13 of 19 ratios, zones 2 and 6 at 17 of 19, measured in the #575 review), and below a
relative luminance of about 0.001 to 0.014 any mix passes. Those pixels are not a third hue
under the definition, but a cross could hide in them, so the rules above, not this check, are
what keep the rig to two tokens. The check's own self-test feeds it a mix it can detect, zones
5 and 6 (and 1 and 2) at a lit level (relative luminance 0.1 or more; the fit catches 19 of 19
mix ratios of both pairs at 0.1 and at 0.2, measured for this spec), and a per-channel tone map,
and sees both fail.

### The flash budget (S6, decided, #569 review)

**To be built in #577** (the budget, the scheduler and the S6 gate). The numbers here replace the
built ones (the lift column of "Energy by zone", the 12 % tempo pulse, the 25 % accent, the 1.5 ×
build haze) when #577 lands; #577 moves them into the tables the tests read, together with the
code.

**The gate is the authority.** The design below is built to pass the strict measure with margin,
and the arithmetic shows why. But the measure is a property of the frames as shown, and only the
gate on the real running states, **locked with the beat**, decides. A share that passes on its own
proves nothing about the frames: a pull request passes when the gated runs pass.

**The measure** (the Orchestrator's, #569; the scene is held to it on every moment):

- **Regions:** every area of at least 10 % of the screen, measured at least as the whole screen,
  the quadrants, the 3 × 3 grid, the same grid offset by half a cell on each axis (every
  1/3 × 1/3 window at a 1/6 stride), and full-height and full-width strips of 1/3; a finer set
  where a 10 % area could fall between these.
- **Luminance:** the relative luminance, in linear light, of the whole frame as shown (the scene
  **and the text layer**), averaged over the region, every frame at 60 fps.
- **A change** is any monotone run of a region's luminance larger than **10 % of its larger end**.
  Each direction counts, so a flash that rises and falls is two changes. There is no duration or
  abruptness gate: a slow run counts as surely as a fast one. A change is placed at the frame on
  which its run first passes 10 %. Runs are measured on the sum of everything on screen, never one
  kind of light at a time.
- **The gate:** more than **3 changes in any sliding 1 s window**, in any
  region, fails. It holds in the **real running states, locked with the beat**, on every moment,
  and in coasting, off the list, paused and the other states.

**The principle.** Counts of monotone runs do not add up: light below the threshold moves where
the runs of other light begin and end. So the budget is not a sum of shares. **Everything that
may pass the threshold is a scheduled change, and everything else is held so far below it that,
added to anything else that is not scheduled, it still cannot make a run of 10 %.**

**Three kinds of light.**

| Kind | What | Bound |
|---|---|---|
| **Beat-like light** | The beat lift, the tempo pulse, the pattern accent, the wall chase's step, the build's haze step, the lens flash | Every run it makes, alone, is at most **5 %** of its larger end in every region (`--scene-lift-cap`) |
| **Steady light** | Motion (the looks, re-aims, phrase flips, the gather, the fan's turn), the haze's drift, the wall's slow wave, the score's travel | In every region, at most **3 %** of its luminance over any 1 s, and over any one beat when the beat is slower than 60 bpm (`--scene-steady-max`) |
| **Scheduled changes** | Every text step, and the rig's bursts, ramps, steps and dims (the tables below) | Placed by the scheduler: at most **3** in any 1 s with the beat-like light running, at most **2** without it, **counted as if each changed every region** |

**Why that adds up, on the combined signal.**

- **With the beat running** (Beat level, or Tempo only), a lift, a pulse or an accent starts at
  least once a beat. It lifts **every light of the rig by the same share** (beams, lenses, haze
  glow, wall), so it reaches every region the rig lights, and its rise ends any falling run there. So a run that holds no scheduled change
  spans at most one beat: at most 4.8 % of beat-like light (the largest, the 5 % accent or a
  build's 5 % rise, is 0.05 / 1.05 of its larger end) plus 3 % of steady light, **7.8 %**. That leaves **2.2 %** of margin under
  10 %. Beat-like and steady light then make **no** change, and the scheduler may use all 3.
- **Without the beat** (None level: coasting, off the list, paused, manual clock, hold, no
  `bpm`), nothing breaks a steady run. A steady run passes 10 % only after at least 3.3 s one way,
  so steady light makes at most 1 change in any 1 s, and the scheduler uses at most 2.
- **Around a scheduled run** (a ramp, a burst's decay, a dim's edge), all beat-like light is held
  at rest (the hold, below), so no lift splits it. Steady light cannot split it either: it can only
  reverse a region where the scheduled run is slower than 3 % a second, and there the scheduled
  run moves that region by less than 2.1 % in its 700 ms. The longest hold is 1.25 s (an interval
  change), in which steady light moves at most 3.75 %; with the fall of the last lift before the
  hold, 4.8 %, that is **8.55 %**, still under 10 %.
- **Where a region holds no rig light** (inside the score or the gel, which are opaque and never
  lifted), nothing breaks a run, but nothing in it moves except the score's slow travel and the
  ticks; the gated runs decide there as everywhere.
- **A one-frame step is one change at most**, however many things move in it. So text steps and
  the rig's own steps share frames wherever they can (the ticks, below).

The reviewer's pairings on #569 now give: a 4.5 % lift (zone 7) with 3 % a second of steady
light at 90 bpm, a falling run of at most 4.3 + 2.0 = 6.3 %; a build at 120 bpm, at most
4.8 + 1.5 = 6.3 %; a steady reversal inside a ramp, at most 2.1 % per part. None is a change.

**Beat-like light, the numbers.**

| Effect | Amplitude | Shape |
|---|---|---|
| Beat lift (Beat level), on every light of the rig by the same share (never the gel, the score or the text) | 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5 % for zones 1 to 7 (they replace the energy table's column in #577) | Rise 40 ms, fall 200 ms, back at rest before the next lift; at most 3 a second (above 180 bpm on every second beat) |
| Tempo pulse (Tempo only) | 4 % (`--scene-tempo-pulse`) | Its own phase, at the bpm, as before |
| Pattern accent (Beat level) | 5 %, on the first beat of each side, **in place of** that beat's lift, never added to it; with or without a side step (a first side, a side after `next_downbeat`, "then up again") | As the lift |
| Wall chase step | Whatever keeps each region within 5 %: the chase is a moving pattern with the same number of lit dots in any region, so it travels rather than flashes | One step a beat, at most 3 a second |
| Build's haze step (Beat level) | The haze rises by 3 % on each beat of the build, on the lift's rise, and stays up through the fall, so each rise (step and lift together) is at most 5 %: the lift in a build is 2 %. Over 8 beats about 1.25 × | The haze step and the lift share one 40 ms rise |
| Lens flash at an interval change | Each lens is **0.5 white at rest** (its hot core); the flash raises it by `--scene-lens-flash`, **0.25**, to 0.75 at the peak, lowered until no region moves more than 5 % | 160 ms (`--m-flash`): rise 40 ms, fall 120 ms, starting on the change frame |

Below the Beat level the build's haze rises as steady light (at most 3 % a second), and there
is no lift.

The beat stays readable: the whole rig breathes on it, the wall's chase steps on it, the accent
marks each side, and the text layer's count, beat dot and bars line are unchanged.

**The hold.** All beat-like light is **held at rest** from **250 ms before** a scheduled run
starts until **300 ms after** it ends (`--scene-hold`). The lead is longer than a whole lift
(40 + 200 ms), so no lift is rising or falling when the run starts: a lift that would start in
the hold is skipped, and none is ever cut. The pattern accent and the lens flash are not held:
the accent replaces a lift where the side step is a one-frame step (one frame needs no hold), and
the lens flash is the interval change's own. At an interval change the hold runs from
`t0 - 950 ms` to `t0 + 300 ms`.

**Text in the budget.** The text layer is part of the frame, so its steps count. Measured for
this spec (headless Chromium, 1920 × 1080, the room's own face, `--light-1` on a dark room of
0.010 and 0.033 in linear light): one step of the pattern count (18 vh) moves the worst region of
the named set by up to **31 %** and the worst 10 % window of a finer set by up to **51 %**; one
step of the countdown (26 vh), by up to **30 %** and **78 %**. Some steps are smaller (3 to 2:
1.1 %), but any may be a change. So:

1. **Ticks.** Every text step of the running layout falls on a **tick**: one frame in which all
   the text that changes, changes. The countdown's seconds are ticks. At the Beat level the
   bars line steps on the first countdown tick at or after its downbeat. When a count runs, the
   count, its side word and its squares step on the beat; the countdown's seconds and the bars
   line join the first count tick at or after them (at most one tick late, never early).
2. **At most 2 text ticks in any 1 s,** and 1 when no count runs. So the count steps **on every
   beat below 120 bpm and on every second beat from 120 bpm** ("8, 6, 4, 2", always on the switch
   beat; every fourth from 240 bpm), and its squares step with it. A text step that would make
   a third tick joins the next tick: the latest value wins.
3. **The change frame.** At an interval change the gel's cut, its numeral and name, the new values,
   the next row and the countdown's reset are **one frame**, at `t0`. On the scene the white line
   down the gel's edge (`--m-flash` in room-2d.md) is **not drawn**: the lens flash marks the
   change, and the line alone was two changes.
4. **Labels and plates** ("Change in", "estimated", the link plates, "Paused") appear and go on a
   tick, as any other text step.
5. **What is not a tick.** The score's travel (0.2 vw a second at 8 minutes a screen) is steady
   light and keeps its bound. The beat dot is not on the scene (the lift carries the beat).

The count's step every second beat from 120 bpm is a change to the pattern block, decided here
for the scene; the plain screen keeps room-2d.md until its own pull request takes it up (the
PR's notes name it for the Orchestrator).

**The scheduled changes, their shapes and how many each makes.**

| Event | Changes | Shape |
|---|---|---|
| A text tick | 1 | One frame |
| The change frame at an interval change | 1 | One frame at `t0`: the gel, the text, and with no ramp the new energy |
| Energy ramp at an interval change | 1 | 700 ms, linear, ending at `t0`; only when there is room (below), otherwise the energy is in the change frame |
| Drop burst; light-only burst (a song without moments) | 2 | Up in **one frame** to 0.85 of white at the moment; decay 250 ms to the level after it (the new zone's, or the drop's fan with every fixture on) |
| Song-change dim | 2 | Down in 120 ms to 25 %, held, up in 120 ms on the new song's first beat |
| Pattern side step (100 % and 72 %) | 0 | **One frame on the switch beat's count tick**: it shares the tick's frame |
| End of the drop's fan, start and end of a breakdown, the house looks in and out, a quality step (High to Medium drops 6 fixtures and a haze layer; Medium to Low 6 more and the wall) | 1 | 700 ms, linear; a fixture or layer that goes fades to 0 in it |
| Pause and resume | 1 each | 250 ms, linear, to 6 % and back; the text changes on the same frame the ramp starts |
| A seek, a 15 s jump, a reload | 1 | One frame: every light and every text at the new position |

**The scheduler.** Before it places an event, the scheduler counts every scheduled change
within each 1 s window the event touches, as if all were in one region. If a window would hold a
fourth (a third without the beat), these apply in this order, again and again, until it fits:

| Order | What gives way | How |
|---|---|---|
| a | The energy ramp of an interval change | No ramp: the energy is in the change frame |
| b | A light-only burst | Skipped: the interval change is a plain one. A skipped burst does not start a new 10 s spacing |
| c | A step of the countdown or the bars line | It joins the next tick or the next frame the rig steps in, never more than 1 s late (latest value wins). The count never waits |
| d | A drop burst | Skipped: the fan's fixtures come on in the drop's frame, which takes the burst's place (1 change) |
| e | A song-change dim | Skipped: the re-aim marks the song |
| f | A single ramp, a quality step | It waits until it fits |
| g | A further user action (pause, resume, seek, jump) within 1 s of the last | Shown at the first frame it fits, at most 1 s later; the latest state wins. A user's action never waits for the rig: the rig's event in progress ends at once in the action's frame |

Fixed timing never moves: `t0`, a drop's moment and a beat. **Colour is never late**: the hue
cross and the anticipation make no change (constant luminance), so they are never scheduled.

**Without the beat** the countdown's tick and steady light leave room for one more change in
any 1 s, so there is no burst, no dim and no energy ramp at the None level: the drop is the
fan's frame, a song change is its re-aim, and an interval change is its change frame.

**Collisions** (two events within 1 s of each other), with the beat running:

| Together | What happens | Changes |
|---|---|---|
| A light-only burst and its interval change | The burst's frame is the change frame, at `t0`: the energy arrives in its decay; no ramp and no lens flash | 2 |
| A drop burst and an interval change | No ramp and no lens flash; the countdown's tick before joins the change frame (c). If both are one frame, the burst's frame is the change frame | 3 |
| A song-change dim and an interval change | **No dim** (e): the interval change goes as usual and the re-aim marks the song | 2 |
| A burst and a song-change dim | No dim: the burst marks the moment | 2 |
| A second drop within 10 s of a burst | No burst: the fan's fixtures come on in the drop's frame | 1 |
| A light-only burst within 10 s of another burst | No burst: a plain interval change | 2 |

**All bursts**, drop bursts and light-only bursts alike, are at least **10 s apart**, and there is
one drop burst at most per drop moment (S6).

**The drop.** For the last **1 s** before a drop the build's haze has finished rising and the
beams **hold still** where the gather has brought them (slowing to a stop over the 250 ms
before): the gather is the song's moment, so this keeps rule 4. The fixtures that come on for
the fan come on under the burst, inside its decay, and the fan's turn starts after the decay.

**Every moment, worst case** (worst region, any 1 s, counted as if every scheduled change changed
every region; "Text" is text ticks, "Rig" the rig's scheduled changes; beat-like and steady light
make none with the beat running):

| Moment | Text | Rig | Steady | Most |
|---|---|---|---|---|
| Beats in any zone, no pattern | 1 | 0 | 0 | 1 |
| Beats in a pattern (count running) | 2 | 0 (the side step shares a tick) | 0 | 2 |
| Interval change | 1 (the tick before) | ramp 1 + change frame 1 | 0 | 3 |
| Interval change, count running | 2 | change frame 1 (no ramp, a) | 0 | 3 |
| Interval change in a song without moments | 1 | burst 2 (its frame is the change frame) | 0 | 3 |
| Interval change in a song without moments, count running | 2 | change frame 1 (no burst, b; no ramp, a) | 0 | 3 |
| Drop | 1 | burst 2 | 0 (the fan's turn after the decay) | 3 |
| Drop on an interval change | 0 (joins the change frame, c) | burst 2 + change frame 1 | 0 | 3 |
| Drop, count running | 2 | the drop's frame 1 (no burst, d) | 0 | 3 |
| Song change | 1 | dim 2 | 0 (the re-aim is steady light) | 3 |
| Song change, count running | 2 | 0 (no dim, e) | 0 | 2 |
| Song change and interval change | 1 | ramp 1 + change frame 1 (no dim) | 0 | 3 |
| Build | 1 (2 with a count) | 0 (the haze step is beat-like) | 0 | 2 |
| Breakdown, the fan's end, the class's end, a quality step | 1 (2 with a count) | 1 | 0 | 3 |
| Anticipation | 1 | 0 (constant luminance) | 0 | 1 |
| Without the beat (coasting, off the list, manual clock, hold, no `bpm`): beats, an interval change, a drop, a song change | 1 | at most 1 (the change frame, the drop's frame, a single ramp) | 1 | 3 |
| Pause, resume, a seek, a jump | 1 (in the action's frame) | 1 (the action's ramp) | 1 | 3 |

**If a gated run fails,** the fix is in the light or the schedule, never in the measure and never
by an exception: for beat-like light, a lower amplitude; for steady light, wider and softer
beams, a lower share of the beams against the haze, then fewer lit fixtures in that zone's row, in
that order (the turn limit, the movement rates and the looks stay); for scheduled changes, the
scheduler's order above. A pull request reports every gated run, by moment and state, with its
worst region and the kind of light that made each change.

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
| Clock | right-aligned to 95 vw, from 10.9 vh | Head line, 4.2 vh high, items centred: label (`--t-label`, or the compact "Paused" plate, 3.6 vh high) and bars line (3.8 vh, Big Shoulders 600, cap 3.1 %, label tier) side by side; 1.6 vh under it the countdown (26 vh, cap 21.1 %). The head line's ink keeps 1 vh from the rail above and the countdown below; see "Fitting" |
| Pattern | from 46 vw, or 2 vw right of the widest metric value if that is further right, from 10.9 vh; only in an interval with a pattern | See "Intervals first: climbs and patterns" and "Fitting" |
| Next | right-aligned to 95 vw, 1.2 vh under the countdown (about 38 to 54 vh) | Line 1: "Next", zone chip, name, length, cadence, position or pattern ("8 up, 8 down") (`--t-minor`, one line). Line 2: **the next interval's cue** (`--t-label`, at most 52 vw wide, at most 3 lines) |
| Cue | 27 vw to 95 vw, ends at 68.4 vh | `--t-text`, two lines; over 60 characters `--t-text-min`, three lines |
| Score | 0, 70.4 vh, full width, to 95 vh | See "The score" |
| Stage | everything else | The rig at full brightness |

### 4:3 and narrower (3:2 and narrower)

| Region | Box | Content |
|---|---|---|
| Gel plate | 0, 0, 30 vw, 48 vh | Numeral 28 vh (cap 22.8 %), name 7.3 vh (cap 5.9 %), targets |
| Rail | 33 vw, 5 vh, to 95 vw | As 16:9, without the segment name |
| Metrics | one row **under the countdown**, 33 vw to 95 vw, from 39.3 vh (to about 52 vh with a folded count) | Cadence, position, BPM side by side, 2.4 vw apart, on one baseline; value and unit only, 7.2 vh (cap 5.85 %): the units ("rpm", "bpm") and the values ("Seated") carry the meaning. As room-2d's narrow layout, nothing stands beside the countdown, so a five-glyph countdown never meets a metric |
| Clock | right-aligned to 95 vw, from 10.9 vh | As 16:9: head line, then the countdown at 26 vh (ink to about 38 vh, the estimated underline included) |
| Next | 5 vw to 95 vw, from 52.5 vh (under the gel and the metrics row) | Line 1 as 16:9, left-aligned; 1 vh under it the next cue (`--t-label`, at most 2 lines) |
| Cue | 5 vw to 95 vw, ends at 80.3 vh | `--t-text-min`, at most 3 lines |
| Score | 0, 81 vh, to 95 vh | Intervals 6.6 vh (no second line: the next cue is in the next row), songs 6.4 vh; **6 minutes** wide; no minute labels under it: the band ends at the safe edge, and its right edge is always 6 minutes ahead (the window never changes in a class); the next interval is in the next row |

In an interval with a pattern there is no room for the pattern block: the Position value becomes
the side and the count (count 13 vh, cap 10.4 %), and the bars line stays. The row is set on
the count's baseline, so the count's top is the row's top and stays 1 vh under the countdown.
Without a count the value reads "Count from the music" (`--t-label`, wrapping in the width the
row leaves it, at most three lines, inside the row's height).
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
  (Big Shoulders 800, min(5 vh, 2.8 vw); 5 vh at 3:2 and narrower), then its **length**
  (Big Shoulders 800, min(3.72 vh, 2.1 vw); 3.72 vh at 3:2 and narrower: at least 2.6 % cap
  height, the label tier), then its name (`--t-label`, 700) on the first
  line, and its **cue** on the second (`--t-label`), ending in an ellipsis at the block's end.
  The length comes before the name and is guaranteed: every interval of **40 s or more** shows
  its number and its length at every supported size. A 40 s block is 7.5 vw wider than 3:2 and
  10 vw at 3:2 and narrower; after the 0.25 vw gap and 0.6 vw padding on each side that leaves
  6.05 vw and 8.55 vw. Number, gap and length measure at most 5.8 vw wider than 3:2 (the caps
  by width hold it at 16:10 and down to 3:2: 5.65 vw at 16:9, 5.72 vw at 16:10, 5.80 vw at
  1520 × 1000) and at most 7.9 vw at 5:4. The name shows only when it fits whole after
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

**Pattern block** (16:9; at 3:2 and narrower, and where "Fitting" leaves it under 16 vw, it is folded into the Position metric, see
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
  10 minutes or more) both fit right of the metrics at 16:9 and 16:10 (at 16:10 the widest value,
  "100–110 rpm", ends about 18 vw before a five-glyph countdown). At 3:2 and narrower they do
  not fit side by side (a five-glyph countdown is about 45 vw wide at 5:4), so the metrics sit in
  a row **under** the countdown (see Layout) and nothing shares its height.
- **Head line**: label and bars line are centred in a 4.2 vh line; the paused label is a compact
  plate (3.6 vh high), so it never reaches the countdown or the rail. Its ink keeps at least 1 vh
  from both in every state.
- **Pattern block**: it starts at 46 vw or 2 vw right of the widest metric value. If its label,
  side, count or squares would come within 2 vw of the countdown's ink, the count steps to
  14.6 vh (cap 11.9 %) and the side to 7.4 vh; the squares and the note wrap in the width left,
  the note always on a line of its own. The label shares the head line's height, so it also ends
  2 vw before the head line's ink (the paused plate, the bars line) and wraps. Where the block
  would get **less than 16 vw** between the cadence or BPM value and the countdown at its widest
  in that interval (five glyphs if the interval starts at 10:00 or more), it **folds into the
  Position value** as at 3:2 and narrower (side and count, count 13 vh), decided once per
  interval; at 16:10 that happens with a five-glyph countdown next to "100–110 rpm".
- **Next row**: line 1 is one line; the next cue wraps at 52 vw (3 lines at most at 16:9; 2 at
  3:2 and narrower), and its ink ends at least 1.5 vh above the cue's first line.
- **Cue**: as room-2d.md (two lines at `--t-text`, over 60 characters `--t-text-min`, three
  lines); the box ends at 68.4 vh (16:9) or 80.3 vh (narrower) and grows upward.
- **Worst case** (checked in every state at every size): 120-character current and next cues,
  a five-glyph countdown, a pattern interval, cadence "100–110 rpm", the widest zone name
  (measured in the number face; the mock-up's `W` sets all of them). The mock-up's clearances
  were measured from the rendered ink at 1024 × 768, 1280 × 1024, 1366 × 768, 1440 × 900,
  1440 × 1080, 1500 × 1000, 1680 × 1050, 1920 × 1080, 1920 × 1200 and 2560 × 1600, running,
  paused, coasting, off the list and before the start: every pair meets S16. The pattern's side
  and count start 1.2 vh under its label, so they stay clear of the head line too.

## States

| State | Rig | Text layer |
|---|---|---|
| Before the start | House look: lights down to 6 % in the first zone's colour, two slow beams, the wall dark, no beat | As room-2d.md "Before the start" (gel lights down, class title, time in each zone) |
| Warm-up (zones 1 and 2) | Calm: few beams, slow sweep, a slow wave on the wall, shallow lift on the beat; the haze clearly blue or teal | Running layout |
| Each zone, 1 to 7 | Colour and energy from the table above | Running layout |
| Interval change coming (last 10 s) | Back truss and wall wipe to the next zone's colour from the far side, from the later of 10 s before the change and the previous change; the front truss stays | Label "Change in" in the last 5 s (room-2d.md); the next row is the next zone with its number and name, so the second colour on screen always has its number beside it |
| Interval change | (To be built in #576 and #577.) The front truss, the floor uplights and the haze cross to the new colour in the 700 ms that end at the change, a wipe from the far side toward the gel, each light switching hue at constant luminance, never a mix; the new zone's energy arrives in one 700 ms ramp ending at the change ("Colour: two hues, never a mix"); the energy is in the change frame instead when a count runs or without the beat; every lens flashes toward white once at the change (160 ms, `--m-flash`, under the flash threshold), unless a burst falls on the same moment, which then replaces it ("The flash budget", collisions) | New values, the gel's cut and the countdown's reset in **one frame** at the change (the gel never shows a mix); on the scene no white line down the gel's edge (#577; the lens flash marks the change) |
| Song change | Rig dims to 25 % for one beat, back on the first beat of the new song (to be built in #577: down in 120 ms and up in 120 ms; no dim when a burst or an interval change falls within 1 s, when a count runs or without the beat); the beams turn to the new song's look at no more than 30 degrees a second, so the turn is done within 3.5 s ("How a beam turns") | Score moves on; song clip and BPM change |
| Build (8 beats before a drop, or a `build` moment) | Beams turn, at the turn limit, to gather at one point in the middle of the room (complete in time up to about 170 bpm), the haze brightens (to be built in #577: a step up of 3 % on each beat, about 1.25 ×, with a lift of 2 %; as built, 1.5 × with a 55 % lift); for the last 1 s before the drop the haze has finished rising and the beams hold still where they are ("The flash budget") | Nothing new (the score shows the "Drop" tick) |
| Drop | One white burst over the whole scene (also at the None level, except paused, holding and off the list) (a peak of 0.85 of white at the drop, 250 ms decay; to be built in #577: up in one frame at the moment, at least 10 s from any other burst, and at the None level or with a count running the fan's frame instead of the burst; with the light-only bursts, the only full-screen flashes; the fan's extra fixtures come on inside the decay), then every fixture on and turning, at the turn limit, to the wide fan for 4 bars (the fan is open within 3.5 s and 4 bars last 5.3 s even at 180 bpm), then the zone's own energy | Unchanged; the text is never flashed (dark-under-text holds during the burst) |
| Breakdown | One slow beam on the front truss and the wall's wave for 8 bars | Unchanged |
| Paused | Lights down: everything to 6 %, frozen where it was | As 2D: gel lights down, "Paused" plate, link plate "Music paused" |
| Coasting (readings stopped or stale) | No beat at all (the beat cannot be measured); the rig keeps the zone's colour and moves at its energy | As 2D: "estimated", dimmed dashed countdown, link plate "Music not heard" |
| Playlist not loaded | The rig is as in the state the class is in: nothing in it changes for this notice, and no light or beam is used to say it | As 2D (room-2d.md "Playlist not loaded", #486, #520): in the link state's place, a white plate "Playlist not loaded" with the square marker, for 30 s after the first Start of the class, only when Start asked the music app to play, and never in place of a link fault ("Music not heard", "Not a class song", "Song is in twice", "Music paused"); the segment name is hidden while it shows; no motion, so reduced motion changes nothing. It takes the place of "Following Spotify" and "Waiting for the first song"; the presenter's own line is in presenter.md |
| Off the list | "Holding" look: no beat, movement halved, brightness 60 %, the song look of the interval's planned song, no moments (a gather, a fan or a breakdown does not run) | As 2D: link plate "Not a class song", BPM "Song, planned" |
| Position pattern, beat known | The zone's look, beams at full on "up" and 72 % on "down", an accent on each switch (to be built in #577: the step in one frame on the switch beat's count tick, the accent 5 % in place of that beat's lift; 25 % as built) | Pattern block: side, beat count, beat squares, "then …"; the count steps on every beat below 120 bpm and on every second beat from 120 bpm (#577, "The flash budget") |
| Position pattern, tempo only (no anchors) | Tempo pulse, no accent | `interval_start`: side and count at the bpm from the interval's start. `next_downbeat`: label and "Count from the music" |
| Position pattern before its first downbeat (`next_downbeat`) | As the zone | Side of the first entry and "starts on the next bar"; no count until the downbeat |
| Position pattern, no lock | No beat, no pattern accent | Pattern block: label and "Count from the music"; no side, no count |
| `pattern_without_bpm` (a pattern in a song with no `bpm`) | No beat, no pulse, no accent | Pattern block: label and "No tempo: count from the music"; the Song metric reads "Song, no tempo" and "–"; the score's strip is left out |
| No beat anchors (tempo only) | Tempo pulse of 4 % (12 % as built; #577), no wall chase, no phrase mirroring | No bars line; no phrase ticks in the score |
| No marked moments | Light-only bursts on the song's interval changes, at least 10 s apart (#577: from any burst, and only with the beat) | No moment ticks in the score |
| Ambiguous, manual clock, hold at a song change | Ambiguous as running; manual clock and hold: no beat, movement at the zone's energy | As 2D |
| Last interval | As its zone | As 2D ("End" mark in the score) |
| Finished | House lights up: the rig white and still, at 40 %; the wall white | As 2D "Class Complete" (white gel) |
| Scene killed or too slow | The plain 2D screen within 2 s, in the clock's state (plan section 9) | **One cut**, no animation: the text jumps once from this layout to room-2d.md's layout with the same values; the clock does not pause or restart |

## Motion and reduced motion

- **Limits, always:** nothing lifts, steps or flashes more than **3 times a second** (above
  180 BPM the lift is on every second beat, as the 2D beat dot); a beam turns at most 30 degrees
  a second on every frame, steps in the model included ("How a beam turns"); the bursts (the drop's, and the light-only bursts of a song without moments) are the only
  full-screen flashes, at most once per drop moment or interval change, never within 10 s of
  another, and counted within the 3-a-second limit; the lens flash at an interval change is the
  other orchestrated moment (a burst on the same moment replaces it). The beat lift is a
  brightness change of at most 4.5 % (2 % in a build, with the haze's step; to be built in #577,
  on every light of the rig; 45 % and 55 % of the beams as built), never on the gel, the score
  or the text, so that no run of beat-like light passes 5 %; every change, the text's included,
  fits "The flash budget" (S6).
- **Colour, always:** two hues and white, never a mix ("Colour: two hues, never a mix", S5).
- **Reduced motion** (the system setting or the player's own): the room shows the **plain 2D
  screen** (plan section 3: plain mode is for reduced motion). Where the scene is shown anyway
  (the presenter preview, CI's reduced screenshots), it is the **still rig**: the song's look
  frozen, no beat lift, no sweep, no wall chase, no burst, no lens flash, no dim, no haze step, colour changes
  instant (every light's token and energy in one frame at the change, the gel cut with it; no
  wipe and no ramp), anticipation shown as an instant change of the back truss's and the wall's
  colour, the score in whole-second
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
| S1. Text height (cap height / screen height) | As C1, **measured in the product's own browser** (cap heights about 2.3 % lower than the mock-up's), so the product's sizes carry that margin over the floors, which are not lowered. Countdown at least **20 %** (26 vh gives 21.1 %); zone numeral at least **25 %** wider than 3:2 (32 vh: 26.0 %) and **22 %** at 3:2 and narrower (28 vh: 22.8 %; a deliberate departure from C1's 25 %, so the clock, the metrics and a 6-minute score fit beside and under a 30 vw gel); metric values, zone name and pattern side at least **5.5 %** (narrow values 7.2 vh: 5.85 %; narrow name 7.3 vh: 5.9 %; a name stepped down by the fitting rules: 3 %); the pattern's beat count at least **10 %** (14.6 % at 16:9, 11.9 % stepped, 10.4 % folded); the cue, class time and next row's first line at least **3 %**; labels, the next cue, link state and score text at least **2 %** |
| S2. Contrast | **Only `--light-1` text over the scene.** Text against the worst pixel under its ink, over a sequence of at least 120 frames covering a beat, a build, a drop and an interval change: at least **7 : 1** for every text on the scene, labels included. The scene's relative luminance inside each text box (grown by 1.2 vh, faded over 3 vh) is at most **0.08** on every frame. Text on opaque fills as room-2d.md |
| S3. Look-ahead | The score shows at least **5 minutes** ahead of "now" at every supported size (**8** at 16:9 and wider, **6** at 3:2 and narrower, to the screen's edge). Every interval of **40 s or more** starting within the labelled window (7 min at 16:9, 5 min narrower) shows its **number and its length**; any block that cannot show its number shows no zone colour. The **next interval's number, name, length, targets and cue are always on screen in the next row**, whatever the score shows |
| S4. Visible at once | All nine content items in every running state, with the band hidden, at every supported size |
| S5. Zone | The zone is a number and a name as well as a colour on the gel, the next row and the score (as C5); a score block never shows its colour without its number. The rig shows only the current zone's colour, the next zone's colour during the 10 s anticipation (while its number and name are in the next row), and white. Never another hue, never a measured heart-rate zone (rule 7). A token keeps its hue at any lightness and any share of white: in linear light every rig pixel is `a × T + w × white` for one allowed token `T`. Tested on the rendered pixels of every frame of the S6 runs, 0 failing pixels ("Colour: two hues, never a mix", the test) |
| S6. Flashes | No region larger than 10 % of the screen changes in relative luminance by more than 10 % more than 3 times in any second; the drop burst and the light-only bursts count within that limit. One full-screen burst per drop moment (or per interval change in a song without moments), at least 10 s apart. Measured as "The flash budget" says (every region of at least 10 %, each direction a change, no duration gate, any sliding 1 s), locked with the beat and in every other state; **the gate on the real running states, locked with the beat, is the authority**. To be built in #577, the design that meets it: beat-like light at most 5 % per run in every region, steady light at most 3 % of a region in any 1 s, and the scheduled changes, text ticks included, at most 3 in any 1 s with the beat running and 2 without |
| S7. Movement | The camera never moves. No beam turns faster than 30 degrees a second **on any frame**, a re-aim, a phrase flip and a moment included: the drawn direction follows the model's target through a turn-rate limiter ("How a beam turns"). Rule 4: a beam's direction is a function of the song's look, the fixture, the motion phase, the phrase and the song's moments only. Test (scene model): two classes that differ only in their intervals (zones, targets, positions, patterns, cues), evaluated at the same song, look, phrase, moments and **motion phase**, give every beam the same direction; and the motion phase's rate depends only on the zone's row, at most 30 degrees a second. Light-only bursts on interval changes change no direction |
| S8. Beat | Beat lift, wall chase, phrase and pattern accent only at the **Beat** level (lock, `bpm` and anchors), within 50 ms of the anchor beat (spike 1's criterion). At **Tempo only** a pulse of at most 4 % (to be built in #577; 12 % as built) and the pattern count of S14 (at the `bpm` from the interval start, `start_on: "interval_start"` only), and nothing else beat-like. At **None** (paused, coasting, off the list, manual clock, holding, no `bpm`) no lift, pulse or accent. No downbeat is ever guessed |
| S9. Frame rate | ADR 0009's re-check: at the **default quality level (High)**, on a studio-class computer at 1920 × 1080, a **median of at least 58 fps over a full class** and **no second under 30 fps**, from the frame-rate log (once a second, with the quality level). A class that steps down from High misses this criterion; the steps of the table above only keep the room usable on a weaker computer |
| S10. Fallback | Scene killed: the plain 2D screen within 2 s, the clock continuous (plan section 9) |
| S11. Reduced motion | With reduced motion the room shows the plain screen; a still-rig screenshot shows no change between two frames 1 s apart except the score's one-second step, the countdown and the pattern count |
| S12. Hue in the text layer | As C6: hue only on elements that stand for a zone |
| S13. Intervals first | Every interval is its own block in the score: a test class with three intervals inside one song shows three blocks, each with its number, in the look-ahead window. A song clip never hides, merges or reorders interval blocks |
| S14. Pattern count | In an interval with a pattern and a known count (Beat level; or Tempo only with `start_on: "interval_start"`), the side and the count are on screen at all times; at the Beat level the count steps within **50 ms** of the anchor beat (as S8), on every beat below 120 bpm and on every second beat from 120 bpm (to be built in #577; "The flash budget"); the count reaches the next side exactly on the switch beat; the next side is named (also for three- and four-entry patterns). Otherwise no side and no count is shown and the block says why. Every pattern starting in the look-ahead window shows its words in the score or the next row |
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
| `--scene-burst` | 0.85, up in one frame (to be built in #577), decay 250 ms | The burst's peak share of white (peaking at the moment) and its decay |
| `--scene-anticipate` | 10 s | How long before an interval change the next colour comes in |
| `--scene-turn-max` | 30 degrees a second | The fastest any beam turns; the limiter's rate (S7) |
| `--scene-reaim` | 3.5 s at most | The longest a re-aim, phrase flip, gather or fan may take: the largest target step of 105 degrees at the turn limit. Replaces the 1.2 s of earlier revisions, which names nothing now (the song-change dim is one beat) |
| `--scene-lift-max` | 3 per second | The beat lift's highest rate |
| `--scene-lift-cap` | 0.05 (to be built in #577) | The largest run any beat-like light (lift, pulse, accent, wall chase, the build's haze step, lens flash) may make alone in any region, as a share of its larger end (S6) |
| `--scene-steady-max` | 3 % a second (to be built in #577) | The most steady light may move any region in 1 s, and in one beat below 60 bpm (S6) |
| `--scene-hold` | 250 ms before, 300 ms after (to be built in #577) | Beat-like light held at rest around a scheduled run (S6) |
| `--scene-lens-flash` | 0.25 over 0.5 at rest (to be built in #577) | The white share the lens flash adds to a lens, which is 0.5 white at rest; lowered if a region would pass `--scene-lift-cap` |
| `--scene-tempo-pulse` | 0.04 (to be built in #577; 0.12 as built) | The tempo pulse's depth when there are no anchors |
| `--score-ahead` | 8 min (6 at 3:2 and narrower) | The score's look-ahead |
| `--score-now` | 10 vw | Where "now" is |
| `--pattern-count` | 18 vh (16:9), 14.6 vh stepped | The pattern's beat count |
| `--pattern-down` | 0.72 | Beam brightness on the "down" side of a pattern |
| `--m-change`, `--m-flash` | as system.md | The rig's colour cross (its length and ease-out, ending at the change) and the lens flash at an interval change; on the scene the gel cuts instead of crossing, and draws no white edge line (#577) |

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

**Mock-up as of this revision (#574).** It shows the two-hue colour: one token per light, the
ownership composite, the cross landing on the change from the far side with its energy ramp,
the anticipation as hue switches at constant luminance, a hue-preserving tone map, one sRGB
encoding and a nearest-neighbour scale-up; the S5 test above finds no failing canvas pixel in
it mid-cross (zones 4 to 5 and 1 to 2). It has the new beat-like amplitudes on every light of the rig, the accent in place of the
lift, the build's haze step on the beat, the lens at 0.5 white with its 0.25 flash, the hold, the
gather holding still for the last second, the burst up in one frame and no white edge line on the
gel, but not the scheduler of "The flash budget" or its text ticks (the count steps on every beat,
the energy always ramps, the dim and the bursts are never left out). It still blends a song change's directions over 1.2 s and has no
turn-rate limiter, so a re-aim in it can exceed 30 degrees a second. The limiter and the 3.5 s
bound are specified in "How a beam turns"; the mock-up shows the looks, the colour and the
score, not the turn speed, and is not a reference for it.

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
  is known"), **Worst case** (120-character current and next cues, a countdown over 10 minutes, cadence "100–110 rpm" and the widest zone name, measured in the number face, in the gel and the next row), and **Sound**: a synthesised beat (kick, hats, a riser and a crash on the drop), so the light can
  be judged against something audible. Nothing is fetched.
- Keys: Space pause, arrows jump 15 s, `1` to `7` jump to that zone, `D` before the next drop,
  `S` before the next song change, `I` before the next interval change, `C` the next climb,
  `J` the next pattern, `B` music detail, `W` worst case, `M` reduced motion,
  `Q` quality, `A` sound, `H` hide the panel. The URL takes `?t=` (seconds), `state=`, `rm=1`,
  `q=`, `detail=` (`full`, `noanchors`, `nomoments`, `nobpm`) and `worst=1`, for screenshots.
- It is a reference for the look and the timing, not product code: PL6 builds the scene with its
  own model module, tests and screenshot checks.
