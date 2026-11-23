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
| The beat (see "How much of the music is known") | A lift of the rig and a step of the wall's chase, at most 3 a second (a lift of every light of the rig by the same share, 1.5 to 4.5 % by zone, each run at most 5 %, "The flash budget"; built in #577) | Movement speed |
| The phrase (every 8 bars from the anchors) | The look's variation: mirrored, chase direction, which half leads | |
| A song change | The rig dims for one beat (when the flash budget has room, built in #577) and turns to the new song's look at the turn limit (next section): at most 3.5 s, never faster than 30 degrees a second | |
| Moments (`build`, `drop`, `breakdown`) | Build: the 8 beats before a drop (or the `build` moment) gather every beam to one point and the haze brightens (a step up of 3 % on each beat, about 1.25 ×, with a 2 % lift; built in #577). Drop: one white burst, then every fixture on and fanned wide for 4 bars (at least 6.75 s, to be built in #592). Breakdown: one slow beam and the wall, for 8 bars | |
| No moments in the song | Bursts follow the interval changes inside the song (plan section 4), at least 10 s apart from any burst (built in #577 where the flash budget has room: at the None level, and not at the Beat level and at Tempo only (wherever the ramp runs), where the change's ramp takes the room; "The flash budget", item 2): **light only**, no gather and no fan, so no direction follows an interval's timing | Any angle |
| The next interval | **Anticipation**: in the last 10 s before an interval change the back truss and the LED wall turn to the next zone's colour, as a wipe from the far side, at constant luminance; the front truss, the floor uplights and the haze cross in the 700 ms that **end** at the change ("Colour: two hues, never a mix") | |
| A position pattern (format 1.1, beat known) | **Energy only**: the beams at full brightness on the "up" side and at 72 % on the "down" side, and an accent on the first beat of each side. The accent is 5 %, **in place of** that beat's lift, never added to it ("The flash budget"; built in #577). Built in #591: the side's step (100 % and 72 %) is one frame on the count tick that shows the switch; the accent stays on the beat. At most one accent per side, so at most 3 a second | Any angle, height or shape (the rig does not "stand up") |
| Link state | Without a lock, no beat and no tempo pulse (as the 2D beat dot); see the states | |

### How much of the music is known

Plan section 4 and ADR 0003 section 5 set what the scene may do with what the class file gives.
Nothing beat-like is ever guessed: a downbeat that is not known is not drawn.

| Level | When | What runs |
|---|---|---|
| **Beat** | Link locked, the song has `bpm` and `beat_anchors` | Everything: beat lift, wall chase, phrase mirroring, the bars line, the pattern count (both `start_on` values), the pattern accent |
| **Tempo only** | Link locked, `bpm` but no anchors | A shallow **tempo pulse** of the rig (4 %, built in #577; its own phase, not claimed to be on the beat); no wall chase, no phrase, no bars line, no pattern accent. The pattern count runs only for `start_on: "interval_start"` (the default), counted at the bpm from the interval's start; a `next_downbeat` pattern shows "count from the music" |
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
  while paused, holding or off the list. It is light, not a beat. Built in #577: at the None level the
  burst fits where the flash budget has room (no ramp competes), and it is gated there. At the Beat level and at Tempo only (wherever the ramp runs) a drop
  on an interval change has no burst: the ramp comes first and the drop is **the fan's frame** (every fixture on
  in one frame; "The flash budget").
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
   starts turning on the frame the target changes. **The one exception is an unforeseen cause**
   (decided in #592, to be built in #592): after a seek, a 15 s jump, a reload, a lost or regained lock,
   or a resume, the limiter keeps every beam on its **present aim** (the direction drawn on the
   cause's frame) for **2 s of class-clock time** (`--scene-unforeseen-hold`), and then takes the
   model's target and turns at the normal rate. A later cause inside the 2 s starts the 2 s again.
   The present aim, not the old target, is held, so a turn that was under way stops on the cause's
   frame and nothing turns in the 2 s; the haze's drift and the wall's slow wave (steady light) and the
   looks' sway (a kind of its own, counted like a sweep) are held still with it ("Steady light and sweeps"). **Visible effect:** after a seek
   or a jump the beams stay on their old aim for 2 s before they turn to the new position's, and the
   haze and the wall stop drifting for those 2 s; after a resume a frozen turn finishes 2 s later. The 2 s is P2's longest lateness, 1 s, plus 1 s, so the scheduler sees the
   turn coming ("Steady light and sweeps"); it may be shortened only if the scheduler's property
   test still holds at 3.
2. **A re-aim takes as long as its turn needs.** The longest turn, 104.7 degrees, takes 3.5 s,
   so a song change, a phrase flip, a gather or a fan **completes within 3.5 s** of its turn starting (a moment's turn starts 650 ms after the moment; the drop's fan, to be built in #592, 2250 ms after the drop's moment, item 3 below) and most take
   less. The "1.2 s" of the earlier text is gone and names nothing now: the dim is one beat
   long, and no colour belongs to a look (the zone alone gives colour, rule 7). The look
   ranges are not shrunk to fit 1.2 s; that would flatten every look to under 36 degrees.
3. The frame time used is at most 100 ms, so a stalled frame or a tab brought back to the front
   never makes a beam jump. A frame over 100 ms turns the beam by at most 3 degrees.
4. Nothing turns in the first frame of the scene (the beams start on their targets), and nothing
   turns while the rig is frozen (Paused, hold, the still rig).
5. **Beat words.** The only targets that change on a beat are the phrase mirror and the
   lead-half swap (S8, Beat level only): the **target** changes within 50 ms of the anchor beat
   and the beam starts turning on that frame (inside the 2 s hold of item 1, when the hold ends); its
   arrival may be later, up to 3.5 s. A position
   pattern never changes a target (rule 4, "What drives what"): its accent on the first beat of
   a side is **brightness only**, is not turn-limited, lands within 50 ms of the beat, and is
   carried by the lift and the wall's chase. A beam never "arrives on the beat".
6. **A gather may arrive late.** The gather is the 8 beats before a drop. A gather turn of up to
   83 degrees takes 2.8 s, which fits 8 beats up to about 170 bpm; above that the beams are
   gathered only as far as the limit allows when the drop's burst comes, and then fan. This is
   accepted: the limit is not relaxed for it, and the burst, not the gather, is the event.
7. **Rule 4 holds.** The limiter's state is the drawn direction and its input is the target,
   whose inputs are the five of "What drives what". No interval, zone, target, position,
   pattern or cue reaches it, and its only other inputs are the frame time and **the class-clock
   time of the last unforeseen cause** (item 1). That time comes from a user action or a link
   event, never from an interval or from when a run ends: a hold keyed to a run would let an
   interval move a beam.

**What the renderer must do and how it is tested.** The limiter is a pure function in the scene
model, `limitTurn(drawn, target, maxDegrees)`, a later scene-lane issue (the renderer calls it
once per beam per frame). Tests, all in the scene model's own suite, which runs with no
renderer:

- **Unit:** for any drawn direction and target, and frame times from 4 ms to 100 ms, one step
  turns by at most 30 degrees times the frame time (plus 0.01 degrees of rounding), never
  overshoots, reaches the target in the fewest steps, and does nothing when already there. After
  an unforeseen cause, no beam moves for 2 s of class-clock time, and then it turns at the limit
  (to be built in #592).
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
  classes the same sequence of motion phases and frame times, and **the same user actions and link
  events at the same times** (seeks, jumps, reloads, pauses and resumes, lost and regained locks): the phase's rate comes from the
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
| Moment windows | Build: 8 beats (before a drop, or from a `build` moment). Drop fan: 16 beats (4 bars), and, to be built in #592, at least to 6.75 s after the drop (the fan opens within 5.75 s, "The flash budget" item 3). Breakdown: 32 beats (8 bars). A gather wins over a fan, and a song change ends a fan with its song: to be built in #592, a drop less than 2.25 s before its song's end has **no fan turn** (the 58 s drop: its fixtures come on in its frame and the beams hold still until the song change's turn). A breakdown wins over a fan: where a breakdown's moment falls inside the drop's fan window, its 6.75 s floor included, the fan ends there and the breakdown starts (the fan's end is a run that waits or is a step, as everywhere). All counted at the song's `bpm`; **no `bpm`, no window** |
| Without anchors | No phrase: the first phrase, never mirrored |

The largest pan any look or moment reaches is 55 (the wide fan). These are **targets**; what is
drawn is limited to 30 degrees a second by "How a beam turns".

### Energy by zone (owner input 3)

The colour is the zone token, unchanged ([tokens.css](mockups/tokens.css)); it floods the haze,
the beams, the lenses and the wall, so a zone 1 room is unmistakably sky blue and a zone 6 room
coral. Energy rises with the zone:

| Zone | Ambient glow | Fixtures lit (of 22) | Movement (deg/s, at most) | Beat lift | Wall |
|---|---|---|---|---|---|
| 1 | 0.045 | 8 | 6 | 1.5 % | Slow wave |
| 2 | 0.055 | 10 | 8 | 2.0 % | Slow wave |
| 3 | 0.065 | 12 | 11 | 2.5 % | Wave and beat |
| 4 | 0.075 | 15 | 15 | 3.0 % | Beat chase |
| 5 | 0.085 | 17 | 19 | 3.5 % | Beat chase |
| 6 | 0.095 | 20 | 24 | 4.0 % | Beat chase, both ways |
| 7 | 0.11 | 22 | 30 | 4.5 % | Beat chase, both ways |

"Ambient glow" is the linear-light level of the zone colour lighting the haze and the room, before
the beams and before the text rule below; it is kept low so the beams carry the light. A class with
fewer than seven zones uses the rows of its own zone numbers.

The "Beat lift" column is the lift as built (#577), and a test holds the code to this table. It is
a share of **every light of the rig** (beams, lenses, haze glow, wall), 1.5 to 4.5 % and 2 % in a
build, so no run of it passes 5 % in any region ("The flash budget"): measured strictly, a lift and
its fall are two changes in every region a lit beam crosses, and at 120 bpm the larger lifts of
earlier revisions made 5 changes a second (#569). The energy of a zone shows in how many fixtures
are lit, how bright and how fast they are and how dense the haze is, and the beat is a breath on
top, not a flash.

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
| Combined with a burst or a dim | The hue cross runs as above. A burst on the change carries the energy in its decay; a song-change dim within 1 s is left out ("The flash budget", the rules for runs and the scheduler, g) |

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
5 and 6 (and 1 and 2) at a lit level (relative luminance 0.2 or more: the fit catches 19 of 19
mix ratios of both pairs; at 0.1 it catches 17 of 19, because the 5 % and 95 % mixes are within
one code of a token itself; measured in #586), and a per-channel tone map, and sees both fail.

### The flash budget (S6, decided, #569 review)

**Built in #577** (the budget, the scheduler and the S6 gate on the scene's canvas): the numbers here
replaced the earlier ones (the lift column of "Energy by zone", the 12 % tempo pulse, the 25 % accent, the
1.5 × build haze) and are in the tables the tests read. Three things follow from the gated runs.

1. **Steady light and sweeps are two kinds of light (decided in #592; to be built in #592).** As built in #577 the
   scheduler counts all motion as steady light, one change in every 1 s window, beat or no beat, and places no
   run in the 2.5 s after a sweep start. #592 measured the rig on main (steady light drawn alone, every region of
   the gate, every gated moment): a region moves **4.5 to 85 %** in a second at almost every moment, nearly all
   of it from the beams' re-aims, whose light crosses region edges (a re-aim of up to 105 degrees moves a
   region's whole beam share). Holding a re-aim to 3 % a second would need the beams at about 1/20 to 1/60 of
   their light, which hides them. The haze's drift and the wall's slow wave alone read **2.3 to 2.6 %**. So
   `--scene-steady-max` now bounds **steady light** only (the haze's drift and the wall's slow wave; the looks'
   sway at rest is not steady light: the scheduler counts it as 1 where it is live, as it counts a sweep, see
   below), and the beams' re-aims are **sweeps**: the scheduler counts every
   sweep as 1, and a CI check proves the strict measure gives it at most 1 in any 1 s, over a window of at most 4.15 s ("Steady light and sweeps" below). The
   3 % a second is a design sub-budget (#575), not a product rule. **S6's rule and the strict whole-frame gate
   are unchanged by this and stay the authority**: every gated run must still pass them on every moment. Fixed
   frames and count ticks may land inside a sweep and are counted beside it.
2. **Where the scene bursts.** A burst is a rise (its frame, a mark) and a decay (a run), so it adds 2 beside
   steady light's 1. A drop's burst goes up in its fixed frame (P1), and a light-only burst in the change frame.
   **At the None level** (no ramp: the energy is in the change frame) both fit where the window has room: the
   drop at 40 s on its change, the drop at 58 s, the drop 0.4 s after a change (in the change's frame, light
   only) and the light-only burst at 80 s are gated with the budget on (at least one white burst in each). **At the Beat level and at Tempo only (wherever the ramp runs)** a burst
   on an interval change does not fit, whatever the kind: the ramp comes first (step c), its change frame, the
   burst's decay and steady light would be four, so the burst is skipped (step e or f) and the fan comes on in
   the drop's frame. **So a drop on an interval change at the Beat level and at Tempo only (wherever the ramp runs) has no burst**, and a song with no
   moments has no light-only burst there. A drop away from a change bursts at both
   too (58 s). This is a limit of the plan's section 3 and 4 ("a drop bursts", "bursts follow the interval
   changes"), in the Orchestrator's hands for `docs/owner.md`. This item is as built in #577, with steady light
   counted as 1 in every window. Under #592's accounting steady light counts 0 with the beat outside a sweep's
   window, so a burst on an interval change may find room beside the ramp where no sweep's window, no window that
   counts the looks' sway and no other mark is near. #592 reports, for every gated burst moment and state, whether it bursts, and updates S6's burst
   assertions to that report in the same pull request; it may only add bursts (a burst the gate asserts today
   stays), each within the cap and 10 s from the next. **To be built in #592** a burst's decay is counted inside
   the one 1 of steady light, the looks' sway and the sweeps ("A burst's decay is light inside the shared 1"), so a
   burst adds 1, its rise, beside that 1.
3. **The fan's turn follows the drop by 650 ms.** The beams' turn from the gather toward the fan starts 650 ms
   after the drop (a function of the moments only: rule 4 holds, no beam speed changes); the fixtures come on,
   and the burst goes up, in the drop's frame. Without the delay the beams crossing the screen's centre
   put two more changes in the burst's second (a rise at 0.4 s, a fall at 0.9 s) and no drop could burst.
   The fan is open within 4.2 s, inside 4 bars. **To be built in #592:** the fan's turn starts at a **fixed
   offset from the drop's moment alone: the moment plus 2250 ms** (`TURN_DELAY_MS`, 650 ms, stays the minimum
   delay of every moment's turn). 2250 ms is the largest offset of a drop's frame from its moment, under 1 s
   (P1: a drop joins a merged change frame less than 1 s before or after it, and a drop frame chained from an
   earlier drop is at or before the moment), plus the burst's 250 ms decay, plus 1 s. So the decay has ended
   before the moment plus 1250 ms whatever P1 merges, and no 1 s window holds both the decay and the fan's
   sweep. The start depends on the song's moment only, never on an interval change, the drop's frame or
   whether the burst is placed, so rule 4 and S7 hold. The fan is then open within **5.75 s of the drop's
   moment** (2.25 s plus the longest turn, 3.5 s). 4 bars last 4.8 s at 200 bpm, so the drop's fan window runs
   to at least 6.75 s after the moment ("Moment windows"), and the fan is open for at least 1 s at any tempo.

A tick in a fixed frame or another mark's frame shares it.
**Built in #591:** the text layer on the scheduler and the S6 gate on the whole frame, text included ("The text layer on
the scheduler, as built" below). **To be built, owner of the issue to be named:** the finished house look, the pause and resume
ramps and a user action's frame as the scheduler's input.

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
may pass the threshold is counted by the scheduler (a scheduled change, a sweep or the looks' sway),
and everything else is held so far below it that, added to anything else that is not counted, it
still cannot make a run of 10 %.**

**Five kinds of light.**

| Kind | What | Bound |
|---|---|---|
| **Beat-like light** | The beat lift, the tempo pulse, the pattern accent, the wall chase's step, the build's haze step, the lens flash | Every run it makes, alone, is at most **5 %** of its larger end in every region (`--scene-lift-cap`) |
| **Steady light** | The haze's drift, the wall's slow wave, and below the Beat level the build's haze rise (the score's travel is not: it steps on the ticks) | In every region, at most **3 %** of its luminance over any 1 s, and over any one beat when the beat is slower than 60 bpm (`--scene-steady-max`), measured as "Steady light and sweeps" says |
| **Sweeps** | Any span in which a beam's drawn direction is not on its target (the limiter holds it away), whatever changed the target; a beam held on its target is not one: a phrase flip, a gather, a fan, a song change, a new look, a seek, jump or reload, the Beat level entered mid-phrase, a resume after a frozen turn | Counted by the scheduler as **1** in every 1 s window that overlaps the sweep's window (`--scene-sweep-window`, at most **4.15 s**); a CI check proves the strict measure gives at most **1** in any 1 s (`--scene-sweep-max`) |
| **The looks' sway** | The motion phase moving a lit beam held on a look's target at rest (fan, cross, sweep, circle and split all take the phase); **live** while the phase advances and such a beam is lit, so not in a gather, the drop's wide fan, the hold-still before a drop, a pause or the 2 s hold after an unforeseen cause. Not steady light | Counted by the scheduler as **1** in every 1 s window that overlaps a live span, locked and coasting; that 1 covers steady light's possible change, and where the window also overlaps a sweep's window it and the sweep's are one 1; a CI check proves the strict measure gives at most **1** in any such 1 s (`--scene-sway-max`) |
| **Scheduled changes** | Every text step, and the rig's bursts, ramps, steps and dims, each a **step** (one frame) or a **run** (several frames; "Steps and runs" below) | Placed by the scheduler: at most **3** in any 1 s, steady light's possible change, a sweep's count and the sway's count included, **counted as if each changed every region** |

**Steady light and sweeps (decided in #592; to be built in #592 unless marked otherwise).**

*Steady light, measured.* The gate draws the frame with steady light alone: every scheduled change and all
beat-like light taken out (the lift, the lens flash, the bursts, the energy ramp, the dims, the build's haze
steps at the Beat level, the wall's chase), the beams drawn with the **motion phase held at its value on the
first frame of each gated moment's recording** (so the looks' sway is left out, and a beam moves only where it
turns, which is a sweep, whose windows are not read), the text layer left out (between its
steps it is still, so leaving it out is the stricter measure). On that frame, in **every region of the strict
gate** (the 40 of `tools/flash-shots.ts`), relative luminance in linear light, every frame at 60 fps, locked with
the beat and coasting, on every gated moment:

- **The rate** is a region's range in any 1 s (highest less lowest, as a share of the highest). Only the
  one-frame jumps **on frames the scheduler's log names as marks** (a change frame, a quality step, a seek, a
  jump, a reload) are taken out first: each such jump is subtracted from every later frame, and the run prints
  every jump it took out with its frame and its cause. **Any other one-frame jump of more than 2 %** of its
  larger end fails the steady gate, whatever made it (a beam popping on, a target applied in one frame). A
  region under **0.002** is black and not read. In a class slower than 60 bpm the window is one beat when that
  is longer than 1 s.
- **Where it is read:** every 1 s window that does not overlap a sweep's window (below). Inside a window the
  sweep's count covers steady light. The gate asserts that **at least one 1 s window is read** on every gated
  moment in every state, so a moment that lies wholly inside sweeps' windows cannot pass by measuring nothing.
- **Where the rig gives a region less than 8 % of its light**, the region is read on the rig's light alone (the
  gel and the score drawn black), so its bound is 3 % a second of the rig's own light there.
- **The gate** fails if any region of any run reads more than **3 %**. The build slows the haze's drift and the
  wall's wave to at most **2.5 %** on every run (0.5 points of margin), and the run prints each moment's worst
  region, its rate and the jumps taken out.
- **The looks' sway at rest is not steady light** (Orchestrator, 2026-11-23, after #592 measured it). With
  the sway, zone 7 reads up to 12.7 %, and zones 6 and 7 would need the beams at about 1/8 of their light to
  reach 3 %, which flattens the looks (owner input 3, "Energy by zone"). So `--scene-steady-max` does not
  bound the sway. The sway stays bounded by S7 (30° a second), by the looks as they are and by **S6's strict
  whole-frame gate, which stays the authority** and is not changed, and the scheduler **counts it** as 1
  where it is live, the way it counts a sweep ("The looks' sway, counted" below). The steady-light measure
  leaves out the sway by measuring with the motion phase held, and it gates the haze and the wall as above.
  The hold after an unforeseen cause stops the sway as it stops steady light (the hold stops the motion
  phase's clock), so the sway is not live in it.

*The looks' sway, counted (to be built in #592).* The sway can move a region more than steady light's bound
(zone 7 reads up to 12.7 % in 1 s against 3 %), so it may pass the threshold, and it is counted as a sweep is:

- **Its live spans.** The sway is live in every frame in which the motion phase advances and a lit beam is
  held on a look's target at rest. It is not live in a gather, the drop's wide fan or the hold-still before a
  drop (their targets do not take the phase), in a pause or in the 2 s hold after an unforeseen cause (the
  phase is held in both). The scheduler knows the live spans with the sweeps' windows (step a): the song's looks,
  moments and anchors give them, and an unforeseen cause's hold is planned from its frame.
- **Counted as 1** (`--scene-sway-max`) in every 1 s window that overlaps a live span, at every level, in every
  zone row, locked and coasting. The 1 covers steady light's possible change (the check below measures with
  steady light in it), and in a window that also overlaps a sweep's window the sweep's 1 and the sway's are
  **one** 1 (the check measures those windows too). So the count of steady light, the sway and the sweeps
  together is at most **1** in any 1 s window.
- **No run near the sway, at the Beat level and at Tempo only.** No 1 s window that counts the sway holds any
  part of a run, its hold (`--scene-hold`) or its 300 ms tail, and no live span lies between a run's hold and
  the last lift's rise before it, or between its tail and the next lift's rise. A run that would becomes a
  step in a mark, waits, or is skipped (the scheduler, d to f). So the stretches of "Around a scheduled run"
  hold no sway and their sums stand. A run is not fitted beside the sway: a ramp ending on the frame before
  `t0`, the change frame and the sway are 3 already, and a user action 500 ms after `t0`, which nothing
  foresees, would make a fourth.
- **Without the beat** the sway and steady light share **one** 1 (the check measures them together,
  coasting), so the None level counts as before: at most 2 marks and that 1, every ramp and dim a step, and
  a burst's decay inside that 1 (next).
- **A burst's decay is light inside the shared 1** (Orchestrator, 2026-11-23; to be built in #592). It
  replaces the burst's hold, which is gone: nothing tied to a burst or an interval holds the motion phase or
  steady light's clock, and no direction changes. A burst is its rise, a mark in its fixed frame, and its decay,
  which becomes a **ramp within the shared bound**: the scheduler counts the decay inside the **one 1** of steady
  light, the sway and the sweeps, not as a run of its own, so a burst counts **1** (its rise) beside that 1. The
  decay keeps its peak, its 250 ms and its end level; its curve and its share in each region (light levers only)
  are shaped so the strict measure finds at most 1 change in any 1 s window that holds a frame of it, with the
  sway and steady light in it ("The CI gate for a burst's decay", below, measures it with the decay drawn). Every 1 s window then holds at most
  2 marks (the invariant, the rise and user actions included) and that 1: **2 + 1 = 3**, with or without the rise.
  - *Why not by marks.* A user action before the rise may join the rise's fixed frame (P2, 1 s when it joins a
    fixed frame), but one after the rise has no later fixed frame to join and P2 gives it only 500 ms, so marks
    alone cannot close the window. Ticks are never the fourth: they are foreseen, and e and f already skip a
    burst where a tick would make one; the unforeseen action is the case this rule closes.
  - *The sums* rest on that gate. The light-only burst at **80 s** (None level, the sway live): the rise, a user action 500 ms
    later, and the shared 1 (the decay, the sway and steady light): **1 + 1 + 1 = 3**. The drops at **40 s** and
    **58 s**: the rise, one more mark (an action or a tick) and the decay as the shared 1, the sway not live (the
    gather, the hold-still and the wide fan do not take the phase): **3**. Over the 40 s drop's fan turn a window
    holds the sweep's 1 and at most 2 marks and never the decay ("The fan's turn follows the drop"): **3**. The
    58 s drop has **no fan turn** (it is less than 2.25 s before its song's end, "Moment windows"); its beams hold
    still until the song change's turn, 1.75 s or more after its decay, so no window holds both: **3**. A window
    without the rise: 2 marks and the shared 1: **3**.
  - No other run lies in a window that touches a burst: e and f still skip a burst where such a window would
    hold another run that can neither wait nor be a step, and, at the Beat level and Tempo only, where its decay
    would lie near the looks' sway (S6's "no burst on an interval change" stays true). If no light lever brings a
    decay case to 1, #592 stops and reports it to the Orchestrator; it does not drop a burst the S6 gate asserts.
- **A burst cuts a sweep's window** (Orchestrator, 2026-11-23; to be built in #592). Where a foreseen sweep's
  planned window (a phrase flip, a song change, a breakdown's turn, a gather, any sweep) would end less than 1 s
  before a placed burst's decay, or start less than 1 s after it, the **burst wins**: the window is cut so it
  ends at least 1 s before the decay's first frame (or starts at least 1 s after its last). **Only the
  window's length changes.** The turn is not touched: its start, its targets, its direction and its rate stay
  the song's, so rule 4 and S7 hold, and no motion phase is held. Frames of the turn outside the cut window
  stay closed to every other run (as inside it) and are counted in the one shared 1 with the decay, which the
  gate below measures with the whole turn drawn. A window that would overlap the decay itself is not cut: e
  and f skip that burst. An unforeseen cause's turn starts at least 2 s after its frame, so it never comes
  within 1 s after a decay already risen; one not yet risen is placed against the planned turn.
- **The CI gate for a burst's decay** (to be built in #592, required). The sway's and the sweeps' checks draw
  no scheduled change, so neither sees a decay; this gate draws it. Its count c is the most changes the
  **strict measure** finds in any 1 s window that holds a frame of a burst's decay, **whether the sway is live
  or not**, on the frame drawn with **the burst** (its rise and its decay) and everything else (the sway,
  steady light, beat-like light, every turning or held beam, the fixtures the drop turns on), with no other
  scheduled change and the text layer left out; the rise is a mark, so a window that holds the rise frame
  subtracts 1 for it. It **fails if any window counts more than 1**. It runs in three states, **locked with the
  beat at the Beat level, Tempo only, and coasting (None level)**, on:
  - **every burst of the demo class** (the drops at **40 s** and **58 s**, the light-only burst at **80 s**) and of
    the collision class (`COLLIDE_CLASS`: the drop 0.4 s after the change at **40.4 s**), in each state, each drawn as the scheduler places it (where e or f
    skip it in a state, the case is recorded as skipped and must match the S6 burst report, "Where the scene
    bursts");
  - a **generated matrix** of both burst kinds (a drop, under its hold-still and fan; a light-only burst, under
    every look at rest: fan, cross, sweep, circle, split), every zone's row, both phrase parities, the tempos 60
    to 200 bpm of the sway's check, every quality level, in the three states; a state in which e and f place no
    burst on an interval change draws one away from any change and any sweep's window, so no state lacks a case;
  - **the cut window** (B7, B8): a burst of each kind with its decay less than 1 s after the planned window of a
    phrase flip, a song change, a breakdown's turn and a **gather**, and less than 1 s before one's turn, at 0.1 s,
    0.5 s and 0.9 s (for the gather, a drop merged onto an interval change 0.1 s, 0.5 s and 0.9 s before it, so
    its own gather's window is cut, on every look the gather leaves and every zone row), plus the light-only burst at 80 s after song 1's flip at 75 s, in the three states. The case draws the
    sweep's **whole turn**, unchanged, and the burst; it fails if e or f skip the burst, if any turn frame
    differs from the same sweep drawn without the burst (direction and target), or if any 1 s window holding a
    frame of the decay or of the turn after the cut counts more than 1 beside the rise.
  It fails, too, if a burst kind, a state, one of the four named bursts or one of the cut cases has no case. The strict whole-frame
  gate also adds **Tempo only** to its states for the burst moments and runs them with a user action 500 ms
  after the rise; it stays the authority. If the light levers cannot bring a case to 1, #592 stops and
  reports it to the Orchestrator.
- **The gated events against these rules** (demo class and `COLLIDE_CLASS`; e, f, the cut and the fan's
  offset). Every burst S6 asserts stays placed; two windows are cut and one fan turn falls away, no turn moves:
  - *40 s drop* (coasting): gather's window ends 39.0 s, decay 40.0 to 40.25 s, fan turn 42.25 s: no cut.
  - *40.4 s drop* (`COLLIDE_CLASS`, coasting; frame merged onto 40.0 s): the gather's window, ending 39.4 s,
    is **cut to 39.0 s**; fan turn 42.65 s, 2.4 s after the decay.
  - *58 s drop* (locked and coasting): gather's window ends 57.0 s; fan turn would be 60.25 s, after the song
    change at 60 s, so the drop has **no fan turn** ("Moment windows"); the song change's turn is 1.75 s or more
    after the decay.
  - *80 s light-only burst* (coasting): song 1's flip at 75 s plans to 79.15 s, **cut to 79.0 s**; the flip at
    90 s is 9.75 s after the decay.
  - Flips at 16, 32 and 48 s, the song changes at 60 and 100 s, the breakdown at 120 s and the interval changes
    at 20, 100, 120 and 140 s have no burst within 1 s of a window: nothing cut. The fan of the 40 s drop keeps
    40 to 48 s (16 beats at 120 bpm, over the 6.75 s floor).
- **The CI check that the sway makes at most 1.** Its count c is the most changes the **strict measure** finds
  in any 1 s window that overlaps a live span, on the frame drawn with **no scheduled change** and everything
  else (the sway, the steady light, the beat-like light and any turning beam). The check runs a **generated
  matrix**, locked with the beat at the Beat level and at Tempo only, and coasting: every look at rest (fan,
  cross, sweep, circle, split), every zone's row (zones 1 to 7), both phrase parities, the tempos **60, 90,
  120, 150, 180 and 200 bpm**, every quality level, and the windows that straddle the first and the last frame of a case of every sweep cause. It **fails if any case counts more than 1**, and fails if a look or a sweep cause
  has no case. A burst's decay is measured by its own gate ("The CI gate for a burst's decay"), not here. If the light
  levers of "If a gated run fails" (the turn limit, the movement rates and the looks stay) cannot bring a case
  to 1, #592 stops and reports it to the Orchestrator; the spec does not plan for it.
- **Marks beside the sway: gated, not argued.** A window that counts the sway holds at most 2 marks (the
  invariant) and, with the beat, no run. As with a sweep, a mark's step can split one of the sway's runs and c
  is measured without the marks, so the **strict whole-frame gate** holds it: every gated moment at a look at
  rest has the sway live beside its marks (ticks, change frames, text steps and user actions), locked and
  coasting. The gate stays the authority; a moment that counts more than 3 stops #592, which reports it.

*Sweeps.* A **sweep** is any span of frames in which the drawn direction of some beam is **not on its
target**: the turn-rate limiter is holding it away from the target that the look, the fixture, the motion
phase, the phrase and the moments give ("How a beam turns"), **whatever changed that target**. A beam held on
a target that differs from its rest direction is not a sweep: a held gather (the 1 s hold-still before a drop
included), the wide fan once it has arrived, and a mirrored phrase are not sweeps. The definition closes the
list, not its causes. The known causes, each with a measured case
(below): **a phrase flip** (the mirror and the lead-half swap), **a gather**, **a fan**, **a song change**,
**a new look** (leaving the Beat level mid-phrase, which un-mirrors), **a seek, a 15 s jump or a reload** to a
position with other targets (the limiter keeps the drawn direction across it), **entering the Beat level
mid-phrase** (the mirror and the lead half return), and **a resume after a pause that froze a turn** (the rest
of the turn runs after it, item 4 of "How a beam turns"). The **unforeseen causes** are five: **a seek or a
15 s jump**, **a reload**, **a lost lock** (leaving the Beat level, or Tempo only, mid-phrase), **a regained
lock** (entering the Beat level, or Tempo only, mid-phrase) and **a resume**. Their turn starts only after the
2 s hold of "How a beam turns", item 1.

- **The window** starts on the turn's first frame and ends on the frame every beam's drawn direction has
  reached its target, or where the beams hold still before a drop. It is at most **4.15 s**
  (`--scene-sweep-window`: the longest turn, 3.5 s, `--scene-reaim`, plus `TURN_DELAY_MS`, 650 ms) of
  **class-clock time**, so a pause that freezes a turn freezes its window with it. Where the turn is foreseen
  (a phrase flip, a gather, a fan, a song change: a function of the song's order, anchors and moments only,
  rule 4, S7), the scheduler plans the window from the turn's first frame (the moment, or the moment plus
  `TURN_DELAY_MS` where the turn follows it; the drop's fan from its start in "The fan's turn follows the drop") for the full 4.15 s, since arrival can only end it sooner; nothing
  moves or shortens a turn. After an unforeseen cause the turn starts on the frame **2 s of class-clock time
  after the cause's frame** (the hold), so from that frame it is foreseen too, and the scheduler plans its
  window from there for the full 4.15 s like any other.
- **Overlaps are one sweep.** Any span in which two turns overlap is one sweep, from the first turn's first
  frame to the last arrival, each turn's part at most 4.15 s. The second turn does **not** wait for the first:
  a phrase flip's target changes on its anchor beat ("How a beam turns", item 5), and a turn held back by
  another sweep would move it off the song's position (rule 4, S7). The only wait is the 2 s hold after an
  unforeseen cause, which every turn in it shares and which depends only on the cause's time.
- **The scheduler counts every sweep as 1** (`--scene-sweep-max`), the most it may make, in every 1 s window
  that overlaps its window, whatever its cause; no table of counts by kind is used for scheduling. The 1 covers
  steady light's possible change too, and the sway's where the window also counts it (both CI checks measure
  with them in it). **No run
  overlaps a sweep's window, with no exception**: a sweep moves a region 20 to 85 % a second and can reverse it
  inside a run, splitting it (the 2.1 % of "A run is whole" holds for steady light only).
- **After an unforeseen cause (to be built in #592).** A seek or a jump, a reload, a lost lock, a regained lock
  or a resume cannot be foreseen, so the beams hold their present aim for 2 s of class-clock time ("How a beam
  turns", item 1) and the schedule makes room in that time:
  - **A run in progress ends in the cause's frame**, the frame P2 places for it as for a user action ("The
    rules for runs", 1), **at most 1 s after the cause**. The run so far is already counted, and the frame is
    the cause's own mark.
  - **The other marks are placed by P2 as everywhere else**: P2's 500 ms rule, C10 and S14 are unchanged.
    The invariant (any two marks at least 500 ms apart) already keeps the marks to 2 in any 1 s, so nothing
    else gives way to the hold.
  - **Steady light and the sway are held still in the hold**, with the beams: the haze's drift and the wall's
    slow wave (steady light) and the looks' sway stop on the cause's frame and go on 2 s after it. Their own clocks, steady light's and the
    motion phase's, **stop in the hold and resume from where they stopped**, as the drift's clock already does
    in the still rig; they **never catch up** to the class clock, which would be a one-frame step of up to 2 s of
    drift or sway. So neither makes a change in the hold. **The sway** is live again from the hold's end where
    the look is at rest, and counted 1 in every window that overlaps it; the run in progress ended at most 1 s
    after the cause, so at least 1 s before the hold's end, and no window that counts the sway holds it.
    **Steady light's** earliest possible change counts **only time outside the hold**: at least **1.73 s of it
    after the last lift's rise** (the fall of that lift, then 3 % a second), so at least 1.73 s after the hold
    ends where the lift came just before the cause. The scheduler's "1.73 s after the last rise" is measured
    the same way, and it decides only where the sway is not live (where it is, the sway's 1 covers steady
    light's). This is what keeps a **lost lock** inside the cap: the rig leaves the Beat level (steady light
    counted 0; runs placed beside 2 marks only where the sway is not live) for coasting (steady light counted
    again, as one 1 with the sway where it is live) in a window the scheduler has already filled; held still,
    neither can add a fourth beside the run, the cause's frame and a fixed frame in it.
  - **No new run may end less than 1 s before the turn's first frame** (2 s after the cause's frame), and none
    overlaps the turn's window, which the scheduler plans from that frame like any foreseen sweep's.
  - So every 1 s window **in the hold** holds at most the run that ended (1) and 2 marks (the invariant; the
    cause's frame among them), steady light 0, the sway 0 and no sweep: **3**; every window **over the turn** holds the
    sweep (1), at most 2 marks and no run: **3**; and after the hold of **an unforeseen cause that changes no
    target** (a lost lock at an even phrase, a lost lock from Tempo only, a seek or a reload to the same targets,
    a resume with no frozen turn), the state reached keeps its own row: with the beat, steady light 0 beside 2
    marks and a run where the sway is not live, and the sway's 1 beside 2 marks and no run where it is;
    without it, 2 marks and the one 1 of steady light and the sway, with no run: **3**.
    All by construction.
  - **Gated moments** (required, in the strict whole-frame gate): each unforeseen cause once **with a run in
    progress** and once **with a run that ended just before it**, and **a lost lock at 60 bpm with the
    countdown's ticks running and a run in progress**. They must hold 3, as the construction gives; if one
    counts more, #592 stops and reports it to the Orchestrator.
- **The CI check that a sweep makes at most 1.** Its count c is the most changes the **strict measure** (the
  gate's regions, monotone runs of more than 10 % of the larger end, each direction a change) finds in any 1 s
  of its window, on the frame drawn with **no scheduled change** (no burst, ramp, dim, energy step, quality step
  or text step; the text layer left out) and **everything else**: the turning beams, the steady light and the
  beat-like light, so that a lift splitting a sweep's run is counted too. The check runs a **generated
  matrix**, locked with the beat and coasting: every look (fan, cross, sweep, circle, split), every zone's row
  (zones 1 to 7), both phrase parities (and so either half leading), the tempos **60, 90, 120, 150, 180 and
  200 bpm** (where the lifts fall against the turn, and a gather's 8 beats, depend on it), **every quality
  level** (High, Medium, Low: the fixtures lit), and for two turns that overlap, every offset between their
  first frames in steps of **at most 250 ms** across the window; it also holds a case of every cause in the
  list above. It **fails if any case counts more than 1**, and **fails if a cause has no
  measured case**. If the light levers of "If a gated run fails" (the turn limit, the movement rates and the
  looks stay) cannot bring a case to 1, #592 stops and reports it to the Orchestrator; the spec does not plan
  for it.
- **Marks inside a sweep: gated, not argued.** A 1 s window over a sweep holds at most 2 marks (the invariant,
  unchanged), the sweep's 1 and no run. That alone does not prove 3: a mark's step that reverses a region
  inside one of the sweep's monotone runs (the side step from 100 % to 72 %, a text step of up to 78 % in its
  region, the energy in a change frame) can split that run in two, and c is measured without the marks. So the
  **strict whole-frame gate** holds a moment with **each mark type inside each sweep cause**, wherever the
  states allow it: a count tick, the side step, a text step, a change frame and a user action, each inside a
  phrase flip, a gather, a fan, a song change, a new look, a seek or a jump, the Beat level entered, and a
  resume (each turning after its 2 s hold). The gate stays the authority. If a moment counts more than 3, #592 stops and reports it to the
  Orchestrator. **What this sample does not cover:** the moments are the demo class's, so each pairing is
  gated in that class's look, zone row, tempo, quality level and phrase, at the offset its moments give; other
  looks, rows, tempos, quality levels and offsets of a mark against a turn are covered only for the sweep
  alone (the matrix), not with the mark. That residual is the Orchestrator's to weigh.
- **An unforeseen mark is placed by P2.** The frame of a lost or regained lock (its plate, and the end of a run
  in progress, "The rules for runs", 1), and any other mark nothing foresaw, is placed by text rule 2's P2 as a
  user action's is: at least 500 ms from every mark, or joined to a fixed frame, at most 1 s after its cause,
  so the invariant holds and the run has ended before the hold is over.
- **What gives way to a sweep.**
  - **The energy ramp waits, and a change frame is never moved.** Where a sweep's planned window would hold any
    part of an interval change's ramp or its hold (`t0 - 950 ms` to `t0`), the ramp does not start in the
    window; it must end on the frame before `t0` and `t0` never moves, so waiting leaves it no room and its
    energy goes up in the change frame (step d). The sweep, its turn and the change frame are never moved, and
    no light is lowered to make room.
  - **Any other run** that may wait (the fan's end, a breakdown, the house looks, a quality step) waits for the
    first gap after the window that holds it whole, or becomes a step in a mark (step d). A burst whose decay
    would overlap a sweep's window is skipped (steps e and f); a window that would only come less than 1 s
    before or after the decay is cut and the burst placed (to be built in #592, "A burst cuts a sweep's window"). A drop's own gather and fan are not in the way of
    its burst: the gather's window ends where the beams hold still, 1 s before the drop (cut to 1 s before the
    drop's frame where P1 merges the drop onto an earlier interval change, as at 40.4 s), and the fan's turn, and
    so its window, starts at least 1 s after the 250 ms decay has ended (as built in #577, 650 ms after the
    drop; to be built in #592, 2250 ms after the drop's moment, whatever P1 merges).
  - **Marks are not thinned.** Ticks, fixed frames and user actions are placed by text rule 2 as everywhere
    else; a user action is never shown more than 1 s late.
- **The loop test for a run wanted just after a phrase flip** (mutation M8 of the #590 review, required): an
  energy ramp, a fan's end and a breakdown each wanted inside a phrase flip's window are not placed in it (the
  ramp's energy is in its change frame; the others wait for the gap after the window or are a step), and no
  1 s window over the flip counts more than 3, the flip's 1 included. One case wants its run between 2.5 s and
  4.15 s after the flip, so the test fails if the window is shortened to the 2.5 s of #577.

**Why that adds up, on the combined signal.** The bullets below hold outside the sweeps' windows; inside one,
the sweep's 1 stands in place of steady light's, beside at most 2 marks and no run, with no exception (an
unforeseen cause's turn waits 2 s, "Steady light and sweeps"), and the strict gate decides whether a mark
splits a sweep's run (the last bullet). In a window that counts the looks' sway, the sway's 1 does the same
(the bullet on the sway).

- **With the beat running** (Beat level, or Tempo only), a lift, a pulse or an accent starts at
  least once a beat. It lifts **every light of the rig by the same share** (beams, lenses, haze
  glow, wall), so it reaches every region the rig lights, and its rise ends any falling run there. So a run that holds no scheduled change
  spans at most one beat: at most 4.8 % of beat-like light (the largest, the 5 % accent or a
  build's 5 % rise, is 0.05 / 1.05 of its larger end) plus 3 % of steady light, **7.8 %**. That leaves **2.2 %** of margin under
  10 %. Beat-like and steady light then make **no** change, and the scheduler may use all 3 where
  the looks' sway is not live; where it is, the sway takes one of them (below).
- **Without the beat** (None level: coasting, off the list, paused, manual clock, hold, no
  `bpm`), nothing breaks a steady run. The first can pass 10 % **1.73 s** after the last
  beat-like rise at the earliest (the lift's fall, 4.8 %, then 3 % a second), and each later one
  takes at least 3.3 s one way. So steady light makes at most 1 change in any 1 s, and the
  scheduler counts it (below) and places at most 2 more. Where the sway is live, the sway and
  steady light together make at most 1 (its CI check, coasting), counted as that same 1.
- **A run is whole.** A run is one change only while it is one monotone run, so from its first
  frame to its last nothing else steps in it ("Steps and runs" below). Steady light cannot split
  it: it can only reverse a region where the run is slower than 3 % a second, and there the run
  moves that region by less than 2.1 % in its 700 ms. The sway is never beside a run with the beat
  ("No run near the sway"), and it is held around every burst ("The sway and steady light yield to
  a burst"), so it is beside no decay either.
- **Around a scheduled run**, the stretches with no lift and no scheduled run are bounded too,
  the drift on either side of the hold included:
  - *before it:* from the peak of the last lift before the hold to the run's start is at most one
    beat plus the 250 ms lead, and at most 1.25 s at an interval change (the run starts at
    `t0 - 700 ms`, the hold at `t0 - 950 ms`); steady light moves at most 3.75 % in it (below
    60 bpm, 3 % a beat over at most 1.25 beats, the same), and with the fall of that lift,
    4.8 %, a run there is at most **8.55 %**;
  - *inside a dim:* the dim's low stretch, from the end of its fall to the new song's first beat,
    is at most one beat plus 0.79 s (**1.79 s at 60 bpm**), with steady light alone: at most
    **5.4 %** (below 60 bpm at most two beats, 6 %); a steady run there that runs the way of the
    dim's fall or rise joins that run and adds no change;
  - *after it:* the 300 ms tail and at most one beat to the next lift's rise, at most 3.9 %.
  None reaches 10 %.
- **Where the rig gives a region little light.** A lift ends a falling run only if its rise
  outpaces steady light during its 40 ms. Where the rig gives at least **8 %** of a region's
  light it always does (8 % of the smallest lift, 1.5 %, is 0.12 %, as much as 3 % a second moves
  in 40 ms). Where it gives less (mostly inside the score or the gel, which are opaque and never
  lifted), two rules cover it: (1) **the score's travel steps on the ticks** (in the countdown's
  tick, one frame, the distance since the last; about 0.2 vw a second at 8 minutes a screen), so
  nothing outside the rig moves between ticks; (2) in such a region steady light is held to **3 %
  a second of the rig's own light there**, so the lift, which lifts all the rig's light by the
  same share, outpaces it whatever the rig's share. A region with no rig light at all then has no
  steady light: only its ticks move it.
- **A step is one change at most**, however many things move in its one frame. So text steps
  and the rig's own steps share frames wherever they can (the ticks, below).
- **The looks' sway**, worst case in every state it is live in, outside a sweep's window: with the beat,
  the sway's 1, at most 2 marks (user actions included) and no run: **1 + 2 + 0 = 3**, with a count
  running too (rule 3 for runs); without the beat, the one 1 of the sway and steady light, at most 2
  marks and no run (**3**); in a window that touches a burst, the decay inside that one 1, beside the
  rise and one more mark (**1 + 1 + 1 = 3**, the 80 s burst included); in the hold after an
  unforeseen cause, 0. The sway's own changes are at most 1 by its CI
  check; whether a mark's step splits one of its runs rests on the strict gate ("The looks' sway, counted").
- **Inside a sweep's window** the sum is not argued. The sweep with the steady and beat-like light during it
  gives at most 1 change in any 1 s (the CI matrix), no run lies in the window, and the marks are at most 2 (the
  invariant); whether a mark's step splits one of the sweep's runs is not bounded here, so it rests on the
  strict whole-frame gate's moments with each mark type inside each sweep cause ("Steady light and sweeps").

The reviewer's pairings on #569 now give: a 4.5 % lift (zone 7) with 3 % a second of steady
light at 90 bpm, a falling run of at most 4.3 + 2.0 = 6.3 %; a build at 120 bpm, at most
4.8 + 1.5 = 6.3 %; a steady reversal inside a ramp, at most 2.1 % per part; the longest stretch
in a hold, a dim's low stretch at 60 bpm, at most 5.4 %. None is a change.

**Beat-like light, the numbers.**

| Effect | Amplitude | Shape |
|---|---|---|
| Beat lift (Beat level), on every light of the rig by the same share (never the gel, the score or the text) | 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5 % for zones 1 to 7 (the energy table's column, built in #577) | Rise 40 ms, fall 200 ms, back at rest before the next lift; at most 3 a second (above 180 bpm on every second beat) |
| Tempo pulse (Tempo only) | 4 % (`--scene-tempo-pulse`) | Its own phase, at the bpm, as before |
| Pattern accent (Beat level) | 5 %, on the first beat of each side, **in place of** that beat's lift, never added to it; with or without a side step (a first side, a side after `next_downbeat`, "then up again") | As the lift |
| Wall chase step | Whatever keeps each region within 5 %: the chase is a moving pattern with the same number of lit dots in any region, so it travels rather than flashes | One step a beat, at most 3 a second |
| Build's haze step (Beat level) | The haze rises by 3 % on each beat of the build, on the lift's rise, and stays up through the fall, so each rise (step and lift together) is at most 5 %: the lift in a build is 2 %. Over 8 beats about 1.25 × | The haze step and the lift share one 40 ms rise |
| Lens flash at an interval change | Each lens is **0.5 white at rest** (its hot core); the flash raises it by `--scene-lens-flash`, **0.25**, to 0.75 at the peak, lowered until no region moves more than 5 % | 160 ms (`--m-flash`): rise 40 ms, fall 120 ms, starting on the change frame |

Below the Beat level the build's haze rises as steady light (at most 3 % a second), and there
is no lift.

The beat stays readable: the whole rig breathes on it, the wall's chase steps on it, the accent
marks each side, and the text layer's count, beat dot and bars line are unchanged.

**The hold.** All beat-like light is **held at rest** from **250 ms before** a run starts until
**300 ms after** it ends (`--scene-hold`). The lead is longer than a whole lift (40 + 200 ms), so
no lift is rising or falling when the run starts: a lift that would start in the hold is skipped,
and none is ever cut. The pattern accent is a lift and is held with it. A user action cannot be
foreseen, so its frame puts all beat-like light at rest at once (part of that step), and the
hold runs on from there. Only the lens flash is not held: it starts on the change frame, after
the energy ramp's last frame, and is the interval change's own. At an interval change the hold
runs from `t0 - 950 ms` to `t0 + 300 ms`.

**Text in the budget.** The text layer is part of the frame, so its steps count. Measured for
this spec (headless Chromium, 1920 × 1080, the room's own face, `--light-1` on a dark room of
0.010 and 0.033 in linear light): one step of the pattern count (18 vh) moves the worst region of
the named set by up to **31 %** and the worst 10 % window of a finer set by up to **51 %**; one
step of the countdown (26 vh), by up to **30 %** and **78 %**. Some steps are smaller (3 to 2:
1.1 %), but any may be a change. So:

1. **Ticks.** Every text step of the running layout falls on a **tick**: one frame in which all
   the text that changes, changes. The countdown's seconds are ticks. At the Beat level the
   bars line steps on the first countdown tick at or after its downbeat, and the score steps in
   the countdown's ticks. When a count runs, the count, its side word and its squares step on the
   count's ticks; the countdown's seconds, the bars line and the score's step join the first count
   tick at or after them, never early.
2. **One invariant, one placement.** A **frame mark** is every step a viewer can see on its own:
   a tick, a change frame, a drop's frame and a user action's frame. The change frames and the
   drops' frames are the **fixed frames**.

   **The invariant: any two frame marks, of whatever kind, are at least 500 ms apart, in time.**
   So any 1 s window holds at most **2 frame marks**, plus steady light's 1 at most (inside a sweep's window,
   its 1 instead, with the strict gate deciding: "Steady light and sweeps"). The minimum
   wins over rounding to frames, so it holds at any refresh rate (30 frames at 60 Hz, 25 at
   50 Hz, 72 at 144 Hz), and a "1 s window" is any 1 s of time, from a frame up to but not
   including the frame 1 s later, not a count of frames. This cap is the budget, and the count's
   cadence gives way to it, never the cap.

   **The placement, one procedure:**

   - **P1. Fixed frames first, merged.** Take the interval changes in time order: a **merged
     change frame** at the first `t0` takes every interval change less than 1 s after it, and the
     next change 1 s or more after it starts the next one. It shows the **latest** of them (its
     gel, numeral and name, colour, energy and values). Then the drops: a drop less than 1 s from
     a merged change frame, before or after it, joins it (the nearer one, if two). The drops left
     form **drop frames** the same way, each chained **from the merged frame**: a drop frame at
     the first drop left takes every drop less than 1 s after that frame, so no merge spans 1 s
     or more. Fixed frames are then at least 1 s apart. No `t0` moves later and nothing is aimed
     at a timing.
   - **What a merge shows.** A merged-away interval is **absent everywhere**: the gel, the next
     row, the text layer, the anticipation, the hue cross and the set of tokens S5 allows. Only
     the score keeps its own block, as wide as its length, with no number and no colour (S3, S5). The next interval is always the next one not
     merged away (S3, S5). A drop merges its **light only** onto the frame: which fixtures are
     lit, the energy and the burst; the interval wins what it sets, and the fan's fixtures come
     on in its colour. **Movement never merges**: the end of the gather's hold-still and the start
     of the fan's turn stay on the song's own drop moment ("The drop"), so beam direction depends
     only on the song position (S7, scene rule 4).
   - **P2. Every other mark next, in order of the time it wants:** user actions as they come
     (ticks not yet shown are placed again after one; a later action replaces a pending one in
     its placed frame, the latest state wins), then the count's switch beats, then the
     other ticks. Each takes the **earliest frame at or after its time that is at least 500 ms
     from every mark already placed, fixed frames up to 1 s ahead included**. If that frame is
     too late, more than **500 ms** for a user action or more than **one tick period** for a tick
     (1 s for the countdown, the time to the next beat for the count), the mark **joins the
     nearest following fixed frame** instead, or, if it is a tick and none comes first, it is
     **dropped** (its value shows on the next mark: the latest value wins). An action that joins
     a fixed frame is at most **1 s** late (the fixed frame lies within 1 s, or the earliest frame
     would not have been late); fixed frames stay fixed. The countdown's seconds, the bars line,
     the labels and the score's step are not marks of their own: they show on the first mark at
     or after them.

   The worked case: a tick at C, an action at C + 0.1 and a drop's frame at C + 0.7. The earliest
   frame 500 ms from both the tick and the drop is C + 1.2, 1.1 s late, so the action **joins the
   drop's frame**, 600 ms late; the drop's frame does not move.

   On each beat of a pattern the count ticks if:
   - it is a **switch beat** (the first beat of a side) at least 500 ms after the last frame mark;
     when a side is shorter than 500 ms (one-beat sides above 120 bpm, two-beat sides above
     240 bpm), only a switch beat whose side differs from the side on screen; or
   - it is **any other beat** at least 500 ms after the last frame mark **and** at least 500 ms
     before the next switch beat, so it never takes a switch beat's place.

   Every other beat is **dropped**: its value shows on the next tick (the latest value wins).
   So up to 120 bpm the count steps on every beat; at 180 bpm with 4-beat sides it shows "4, 2,
   then 4" of each side, with 3-beat sides only the switch beat, once a second; with sides of
   500 ms or more the switch beat always shows on its beat. With one-beat sides above 120 bpm the
   side word lags the riders by up to two sides between its ticks; the side step and the squares
   follow the side word, so the rig and the text never disagree.
   A countdown second, the bars line, a label or the score's step that joins a count tick is late
   by less than the longest gap between count ticks: one beat below 120 bpm (**about 1.2 s at
   50 bpm, up to 2 s at 30 bpm**), and under 1.5 s from 120 bpm; a countdown value may then be
   skipped. Near a change frame, a drop's frame or a user action, a count tick may be late by up to
   one tick period, join a fixed frame or be dropped (P2). **This is accepted**: in a pattern the count is the cue riders follow,
   the count and the countdown are right on every tick they show, and the change frame at `t0` is
   never late.
3. **The change frame.** At an interval change the gel's cut, its numeral and name, the new values,
   the next row and the countdown's reset are **one frame**, at `t0`. On the scene the white line
   down the gel's edge (`--m-flash` in room-2d.md) is **not drawn**: the lens flash marks the
   change, and the line alone was two changes.
4. **Labels and plates** ("Change in", "estimated", the link plates, "Paused") appear and go on a
   tick, as any other text step.
5. **What is not a tick.** The beat dot is not on the scene (the lift carries the beat). The
   score's travel is a tick's step (rule 1), not steady light.

The count's cadence (rule 2) and the score's steps on the ticks are changes to the pattern block
and the score, decided here for the scene; the plain screen keeps room-2d.md until its own pull request takes it up (the
PR's notes name it for the Orchestrator).

**Steps and runs.** Every scheduled change is a **step** or a **run**:

- A **step** is one frame: a tick, the change frame, a drop's frame, the side step, a seek, a
  jump or a reload, a user action's frame, a burst's rise, and any rig change made in one frame.
  It is **one change**.
- A **run** is any rig change over more than one frame: the 700 ms ramps (an interval change's
  energy, a breakdown, the fan's end, the class's end, the house looks, a quality step), a
  burst's 250 ms decay, a dim's 120 ms fall and rise, the 250 ms pause and resume ramp, and
  anything added later. It is **one change**, linear, and the general rules below apply to it
  with no list to extend.

| Event | Kind | Shape |
|---|---|---|
| A text tick; the change frame at an interval change | Step | One frame; the change frame at `t0` holds the gel, the text, and with no ramp the new energy |
| Energy ramp at an interval change | Run | 700 ms, linear, ending on the frame before `t0`; only when the scheduler has room, otherwise the energy is in the change frame |
| Drop burst; light-only burst (a song without moments) | Step and run (2); to be built in #592, a step (1) and a decay counted inside the shared 1 of steady light, the sway and sweeps | Up in **one frame** to 0.85 of white at the moment; decay 250 ms to the level after it (the new zone's, or the drop's fan with every fixture on) |
| Song-change dim | Run and run (2) | Down in 120 ms to 25 %, held, up in 120 ms on the new song's first beat |
| Pattern side step (100 % and 72 %) | Step | **One frame on the count tick that shows the switch** (text rule 2): it shares the tick's frame |
| End of the drop's fan, start and end of a breakdown, the house looks in and out, a quality step (High to Medium drops 6 fixtures and a haze layer; Medium to Low 6 more and the wall) | Run, or a step with a count | 700 ms, linear; a fixture or layer that goes fades to 0 in it. With a count running, one frame in a count tick's frame |
| Pause and resume | Step and run, or a step with a count or the looks' sway | The text and the rest of beat-like light in the action's frame; 250 ms, linear, to 6 % and back. With a count running, or at the Beat level and Tempo only where the window counts the sway, to 6 % and back in the action's frame |
| A seek, a 15 s jump, a reload | Step | One frame: every light and every text at the new position; the beams keep their present aim for 2 s and then turn ("How a beam turns", item 1; to be built in #592) |

**The rules for runs:**

1. **Nothing steps inside a run**, from its first frame to its last. Beat-like light is held (the
   hold). Runs are placed **after the marks**, each in a gap between marks that holds it whole
   (the scheduler, c), so no mark (and no side step, which is in a tick's frame) falls inside one,
   and runs never move a mark. No run starts or ends inside another: the later one waits. A user
   action, which cannot be foreseen, ends a run in progress in its own frame.
2. **Fixed frames are never inside a run.** `t0`'s change frame, a drop's frame (once merged,
   text rule 2) and a beat's timing never move, and a user action's frame is placed by text
   rule 2, so a run is placed to end before them or to start on them. The interval change is covered so: its energy ramp ends on the frame before `t0` (its
   change frame is the frame after the run), a light-only burst on it starts on the change frame,
   and any other run that would hold `t0` gives way by the scheduler's order (a dim is skipped,
   any other run waits); when a run starts on the change frame there is no lens flash. A user
   action ends any run in progress in its own frame: the run so far is already counted, and its
   frame is the action's step.
3. **With a count running there are no runs at all.** Every scheduled rig change is a step: in
   the frame of the first count tick at or after its time (a ramp, a quality step, the fan's end),
   in the change frame (the energy), in the drop's frame (the fan's fixtures, no burst), or in the
   user action's frame (pause to 6 % and resume in one frame each). Bursts and dims are skipped.
   So with the count and the beat a 1 s window holds at most **2 frame marks, user actions
   included: 2 changes**, and **3** with the looks' sway's 1 where it is live.

**The scheduler** runs text rule 2's placement and then fits the runs. It counts, in every 1 s
window, as if all were in one region: every mark and every run as 1 (a burst is its frame and
its decay, a dim its two edges), and steady light's possible change at the earliest frame one
could pass 10 % (none while a beat-like rise comes at least once a beat; otherwise 1.73 s after
the last rise, then every 3.3 s, and below 60 bpm 1.73 and 3.3 beats); in a window that overlaps
a sweep's window, the sweep's 1, which covers it ("Steady light and sweeps"); in a window that overlaps a
live span of the looks' sway, the sway's 1, which covers steady light's and is one with a sweep's ("The
looks' sway, counted"). The cap
is **3 in every window**. **As built in #577** steady light is counted as 1 in every window, beat
or no beat, and no run is placed in the 2.5 s after a sweep start; **to be built in #592**: the
count above, the 4.15 s window, the sweep counts and the rows of the table marked so. The steps,
in this order:

| Step | What | How |
|---|---|---|
| a | Fixed frames, the sweeps' windows and the sway's live spans | Fixed frames merged and placed first (text rule 2, P1); they never move afterwards. A sweep's planned window never moves either; to be built in #592 it may only be **cut** for a burst ("A burst cuts a sweep's window"), which changes no turn. The looks' sway's live spans (the song's looks and moments give them; to be built in #592) are known with them. Every foreseen sweep (the song's order, anchors and moments give it), its window planned from its turn's first frame for 4.15 s and counted as 1, is known with them and never moves; an unforeseen cause's turn is planned from the end of its 2 s hold, like a foreseen one (to be built in #592: the window, from 2.5 s, the count and the hold) |
| b | Every other mark | Placed by text rule 2, P2: user actions, the count's switch beats, the other ticks; the countdown, the bars line, the labels and the score's step show on a mark. |
| c | Runs, into the gaps | Each run goes into a gap between marks that holds it whole (rules for runs 1 and 2) and overlaps no sweep's window (built for 2.5 s; 4.15 s to be built in #592); after an unforeseen cause a run in progress ends in the cause's frame, and no run ends less than 1 s before the turn that follows the 2 s hold (to be built in #592); at the Beat level and Tempo only none lies near the sway ("No run near the sway", to be built in #592); with a count running there are none (rule 3) |
| d | A run that does not fit, or would make a fourth (without the beat: every ramp and dim; with it, every run near the looks' sway) | It becomes a step in a mark and adds nothing: the energy ramp in the change frame, any other ramp in the next mark, a user action's ramp in the action's frame; a run that cannot be a step waits for a gap that holds it. **An energy ramp that a sweep's window would hold waits, and so its energy is in the change frame; the change frame is never moved** (to be built in #592) |
| e | A light-only burst | Skipped where a window would still hold a fourth, where its decay would overlap a sweep's window (a planned window that would come less than 1 s before or after the decay is **cut** instead and the burst placed, "A burst cuts a sweep's window"; to be built in #592), or, at the Beat level and Tempo only, where its decay would lie near the looks' sway, or where a window touching it would hold another run that can neither wait nor be a step: a plain interval change at the Beat level and at Tempo only (wherever the ramp runs), where the ramp has the room. Placed at the None level and where nothing else competes. A skipped burst does not start a new 10 s spacing |
| f | A drop burst | Skipped where a window would still hold a fourth, where its decay would overlap another sweep's window (a planned window that would come less than 1 s before or after the decay is **cut** instead and the burst placed, "A burst cuts a sweep's window"; to be built in #592), or, at the Beat level and Tempo only, where its decay would lie near the looks' sway (a drop's gather and wide fan have none), or where a window touching it would hold another run that can neither wait nor be a step: a drop on an interval change at the Beat level and at Tempo only (wherever the ramp runs) (the ramp comes first) or with a count running; the fan's fixtures come on in the drop's frame. Its own gather and fan are not in its way (the gather's window ends 1 s before the drop, cut to 1 s before the drop's frame where P1 merges it earlier; to be built in #592, the fan's turn starts 2250 ms after the drop's moment, at least 1 s after the decay ends) |
| g | A song-change dim | Skipped where a window would still hold a fourth: the re-aim marks the song. Under #592's accounting it is skipped in every state: its rise, on the new song's first beat, lies in the song change's sweep window, which no run overlaps (#592 measures the song change's c and reports it) |

Steady light is never moved, nor is a sweep (its window and its turn are the song's, rule 4 and S7), nor the
looks' sway (its spans are the looks' and the moments'): where its possible change or its count would make a fourth, d to g apply to the runs in that window,
and b to the ticks.

The procedure always ends inside the cap, because every mark keeps the invariant, so **at most
2 in any 1 s** (text rule 2), and everything else is a run, which d to g remove, or steady light, a
sweep or the looks' sway, whose count together is at most 1 in any window:

| State | Frame marks | Runs | Steady light | Sweep | The looks' sway | Counted |
|---|---|---|---|---|---|---|
| Beat running, a count running, outside a sweep's window | at most 2 | 0 (rule 3 for runs) | 0 (a lift at least once a beat) | 0 | 1 where live (to be built in #592), else 0 | **2 + 0 + 0 + 0 + 1 = 3**; 2 where the sway is not live |
| Beat running, no count, outside a sweep's window, the sway not live (a gather, the wide fan, the hold-still) | at most 2 | what the scheduler fits beside them (d to g) | 0 | 0 | 0 | **3** |
| Beat running, no count, a window that counts the sway, outside a sweep's window (to be built in #592) | at most 2 | 0 (no run near the sway; d to f) | 0 | 0 | 1 (its CI check) | **2 + 0 + 0 + 0 + 1 = 3** |
| Without the beat, outside a sweep's window | at most 2 | 0 runs: every run becomes a step in a mark (d) | at most 1 | 0 | in steady light's 1 (one 1 together, its CI check) | **2 + 0 + 1 = 3** |
| Just after a pause (the beat stops) | at most 2 | where the sway was live, 0 (the pause is a step in the action's frame); elsewhere what the scheduler fits beside them and steady light (d to g) | its first possible change at least 0.73 s after the action's frame (1.73 s, or 1.73 beats, after the last lift, which is at most one beat before); where the pause was a step, a falling run joins its fall to 6 % and a rising one needs 3.3 s, so 0 in the window | 0 | 1 up to the action's frame where live, 0 after it (the phase stops) | **3**: 2 + 0 + 0 + 0 + 1 where the sway was live, 2 + runs + steady light where not |
| Any state, a window that touches a burst (its rise or its decay; to be built in #592) | at most 2, the rise among them where the window holds it; a user action may come 500 ms after the rise | 0 (the decay is in the shared 1; no other run in it, e and f) | in the shared 1 | in the shared 1 (e and f, and a drop's fan turn 2250 ms after its moment, keep a sweep's window off the decay) | in the shared 1 (the CI gate for a burst's decay) | **2 + 0 + 1 = 3**, the 80 s light-only burst with a user action 500 ms after the rise included |
| A drop's burst and its fan turn, a user action between them (the drop at 40 s, and a drop merged onto an interval change up to 1 s later; to be built in #592; the 58 s drop has no fan turn, "Moment windows", so only the rows over a burst apply to it, and the song change's turn follows 1.75 s or more after its decay) | at most 2: the rise and the action where the window touches the burst; the action and one more mark over the turn | 0 (the decay is in the shared 1) | in the shared 1 | 0 where the window touches the burst; 1 over the turn (it starts 2250 ms after the moment, at least 1 s after the decay ends) | 0 (the gather, the hold-still and the wide fan do not take the phase) | over the burst **2 + 0 + 1 = 3** (the decay as the 1); over the turn **2 + 0 + 1 = 3** (the sweep as the 1); no window holds both |
| Any state, a window that overlaps a sweep's window (to be built in #592) | at most 2 | 0 (no run overlaps a sweep's window) | in the sweep's 1 | 1 (the CI matrix proves at most 1) | in the sweep's 1 (one 1 together, the sway's check) | **2 + 0 + 1 = 3**, held by the strict gate's moments with each mark type inside each sweep cause |
| The 2 s after an unforeseen cause (a seek or a jump, a reload, a lost lock, a regained lock, a resume), in any state it leaves or enters (to be built in #592) | at most 2, the cause's own frame among them (the invariant) | at most the run in progress, which ends in the cause's frame, at most 1 s after the cause; no new run ends less than 1 s before the turn | 0 (held still in the hold) | 0 (no beam moves in the hold) | 0 (the phase is held) | **2 + 1 + 0 + 0 + 0 = 3** |
| Over the turn that follows the hold (to be built in #592) | at most 2 | 0 (no run overlaps it; none ends less than 1 s before it) | in the sweep's 1 | 1 | in the sweep's 1 | **2 + 0 + 1 = 3**, by construction |
| After the hold of an unforeseen cause that changes no target (to be built in #592) | at most 2 | as the state reached: with the beat, what the scheduler fits where the sway is not live and 0 where it is; without it, 0 (the run in progress ended at least 1 s before the hold's end) | as the state reached: 0 with the beat; without it, its first possible change after at least 1.73 s outside the hold | 0 | as the state reached: 1 from the hold's end where the look is at rest | **3**: with the beat 2 + runs where the sway is not live, 2 + 0 + 1 where it is; without it 2 + 0 + 1 |

**Colour is never late**: the hue cross and the
anticipation make no change (constant luminance), so they are never scheduled.

### The text layer on the scheduler, as built (#591)

One call places every mark for both layers: `render/src/marks-calc.ts` (`planMarks`) builds the fixed frames (P1) and
every other mark (P2) with the model's `placeMarks`, and the canvas's runs (`RunBudget`) and the text (`TextClock`) both
read its answer. The text shows the class **as it was on the last mark** and holds it, so every text step is a mark:

- **The countdown's seconds** are ticks every second **from the interval's start** (the change frame shows the full
  length, each value then holds one second). The rail's clocks, the bars line, the labels and the score's travel show on
  the first mark at or after their time and never before it.
- **A count running** (S14): the countdown's seconds are not marks of their own and show on a count tick. The switch beat of
  each side is a tick of its own (late by at most a beat near a fixed frame, then it joins one or is dropped); any other
  beat ticks only where it is at least 500 ms before the next switch beat, and is **dropped, not moved**, where it is not
  at least 500 ms after the last mark. So the count steps on every beat up to 120 bpm and at 180 bpm with four-beat
  sides shows the switch beat and the third beat. Not built: the rule for sides under 500 ms that a switch beat shows only
  where its side differs from the one on screen (those switch beats are placed greedily, 500 ms apart).
- **The side's step** of the beams (100 % and 72 %) is in the frame of the count tick that shows the switch; the accent
  stays on the beat.
- **A merged-away interval** (P1) is absent from the text (`mergeTextClass`); the score keeps a neutral block for it.
- **A drop under 1 s from an interval change**: its burst, as before, and now the **fan's fixtures** come on in the change
  frame. The beams' turn and the hold-still stay on the song's drop moment (S7, rule 4).
- **A person's action** (pause, resume, seek, jump) is a mark placed by P2: shown within 500 ms.
- **The song-change dim** has no room beside a tick every second: a window holding both its edges and one tick is four
  with steady light. The scheduler leaves it out (step g) and the re-aim marks the song, as step g says. No running state leaves room for it today (a tick every second without a count, no runs at all with one), so its shape (25 %, 120 ms edges) is not built behaviour that anything shows. **Under #592's accounting it still does not return**: steady light no longer takes a place in every window, but the dim's rise, on the new song's first beat, lies in the song change's sweep window (every song change brings a new look, and neighbouring songs never share one), and no run overlaps a sweep's window. #592 measures the song change's cases of the CI matrix and the gated moments at 60 s, 100 s and the dim's own moment at 70 s, locked and coasting, and reports them; the dim returns only by a later change to this spec.
- **A seek or a jump's text frame** is a user action's frame, placed against the marks of the new position; it can fall less than 500 ms of wall time after the last tick shown before the seek. It shares the rig's own one-frame seek step, and the gate counts it by frame time. The action's frame as the scheduler's input stays to be built (above).

**The gate on the whole frame.** `tools/flash-shots.ts` reads the frame as shown: the canvas under the text layer. The
page is played up to each text step; the layer is taken as a screenshot over black and over white with the canvas hidden
(its colour and opacity per pixel), and blended over the canvas of every frame in the page as the browser blends it
(checked to within 1 code value against a real screenshot). The strict 40-region count is on that, and its sliding second is in frame (wall-clock) time: equal to the class clock in normal play, and one frame across a seek or a jump, so a stretch of the class a seek replays is not folded onto its first pass.

**Without the beat** steady light and the looks' sway may take one of the 3 between them, so there is no dim and no energy ramp at the
None level (a song change is its re-aim, an interval change is its change frame and the energy in it). A
burst is not taken away by the missing beat: it is the rise in its fixed frame and a decay, and it
fits wherever the window has the room (built in #577, gated: the drops at 40 s and 58 s and the
light-only burst at 80 s at the None level). To be built in #592 the decay is counted inside the one 1 of
steady light and the sway ("A burst's decay is light inside the shared 1"), so the burst adds its rise. The cap holds by the table above: 2 frame marks, user
actions included, and the one 1 of steady light and the sway, with every run a step in a mark already counted (a: a
ramp into the next mark, the resume ramp into the action's frame). Steady light never waits.

**All bursts**, drop bursts and light-only bursts alike, are at least **10 s apart**, and there is
one drop burst at most per drop moment (S6).

**The drop.** For the last **1 s** before a drop the build's haze has finished rising and the
beams **hold still** where the gather has brought them (slowing to a stop over the 250 ms
before): the gather is the song's moment, so this keeps rule 4. The fixtures that come on for
the fan come on in the drop's frame, under the burst, wherever text rule 2 puts that frame. The
hold-still ends and **the beams' turn follows the song's moments by 650 ms** (`TURN_DELAY_MS`, a function of the moments only, rule 4): the fan's fixtures and the burst come in the drop's frame, and the turn to the fan starts 650 ms later, on the same moment-derived target, so the beams crossing the screen do not add two changes to the burst's second (#577, gated). To be built in #592 it starts 2250 ms after the drop's moment (the drop's frame is under 1 s from it, P1, plus the 250 ms decay, plus 1 s), so no 1 s window holds the burst's decay and the turn, whatever P1 merges ("The fan's turn follows the drop"). It is never on a merged frame.
The turn is a **sweep** (the fan's kind, "Steady light and sweeps"; to be built in #592): as built in #577 it
counts as steady light, under one change in every window. Under #592's accounting its window runs from the turn's
first frame, 650 ms after the drop as built in #577 (to be built in #592: 2250 ms after the drop's moment,
so it starts at least 1 s after the burst's decay ends), for at most 4.15 s; the scheduler counts it as 1 in every 1 s window that
overlaps it, and no run overlaps it. Its start and its target are the song's and never move. A case of the CI
matrix that finds the fan above 1 is fixed in the light (the levers below), never by moving the turn, or stops
#592 as "Steady light and sweeps" says.

**Every moment, worst case.** Every moment (beats, a pattern, an interval change, a drop, a song
change, a build, a breakdown, the anticipation, the class's end, a quality step, a user action)
is decided by the rules above, and its worst 1 s is the scheduler's table: at most 2 frame marks,
user actions included, plus the runs the scheduler fits, or the one 1 of steady light, the looks' sway and a sweep
wherever any of them counts: **at most 3 counted changes, steady light, the sway and sweeps included**. No
list of moments is kept beside it.

**The scheduler's property test** (built in #577, required): random timelines (intervals
of any length, 1 ms ones included, drops anywhere, user actions at any time, every state, tempo,
pattern and refresh rate) are run through the scheduler, and the test asserts on every one that
any two marks are at least 500 ms apart; that fixed frames never move except by P1's merge; that
an action's state is shown at most 500 ms after it, or 1 s when it joins a fixed frame, unless a
later action replaced it in its placed frame (then that frame shows the later state); that no mark falls inside
a run; and that every 1 s window holds at most 3 counted changes, steady light included. **To be built in
#592**, the timelines also hold every sweep cause (phrase flips, gathers, fans, song changes, the Beat level
left and entered mid-phrase, seeks, jumps, reloads and resumes after a frozen turn), overlapping ones among
them, and the test asserts as well that no run overlaps a sweep's window, with no exception; that every 1 s
window that overlaps a sweep counts at most 3 with the sweep as 1, with no exception; that at the Beat level
and Tempo only no run, its hold or its tail lies in a window that counts the looks' sway, and that every 1 s
window that overlaps a live span of the sway counts at most 3 with the sway as 1 (one 1 with steady light's
and a sweep's); that the sway is not live in the 2 s after an unforeseen cause; that no burst holds the motion phase or steady light's clock, a burst's decay is counted inside the shared 1 (its light is gated by "The CI gate for a burst's decay"),
no other run lies in a window that touches it, and every such window counts at most 3 (a fixed case: a
light-only burst at the None level with the sway live and a user action 500 ms after the rise, as at 80 s);
that a drop's fan turn starts 2250 ms after the drop's moment, whatever P1 merges, and no 1 s window holds
both a burst's decay and a sweep (fixed cases: the drop at 40 s, at the Beat level and the None level, each with a
user action 500 ms after the drop and one 900 ms after it, and a drop 0.9 s before an interval change, merged
onto its frame, every window counting at most 3; and the drop at 58 s, less than 2.25 s before its song's end,
with the same levels and actions: the test asserts it has **no fan turn** (its beams hold still from 1 s before
the drop until the song change's turn), that its burst and its light are placed as for any drop, and that
every window counts at most 3); that after an unforeseen
cause no beam turns and no steady light moves for 2 s of class-clock time, a run in progress ends in the
cause's P2-placed frame, and no run ends less than 1 s before the turn; that every unforeseen mark is placed by
P2. The timelines generate a change at the cause between **every ordered pair of link states** the link can
move between: **Beat, Tempo only, coasting, off the list, paused, manual clock, hold, ambiguous and a song with
no `bpm`**, each pair with a run in progress and, where the state has them, with ticks running, at 60 to 200
bpm, and a lock change **during a hold** as well. The spec names no two of these states as one model, so none
stands in for another. **A lost lock at 60 bpm with the countdown's ticks running and a run in progress** is one
of the fixed cases; that a change frame and a sweep's window never move; and that an energy ramp a sweep's
window would hold is a step in the change frame. The loop test for a run wanted just after a phrase flip
("Steady light and sweeps") is one of its fixed cases.

The **strict gate in #577 is the final authority** for any case these rules miss: a gated run
that finds a fourth change is fixed by a rule here, never by an exception.

**If a gated run fails,** the fix is in the light or the schedule, never in the measure and never
by an exception: for beat-like light, a lower amplitude; for steady light, a slower haze drift and wall wave; for the looks' sway and for a sweep, wider and softer
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
| Before the start | House look: lights down to 6 % in the first zone's colour, two slow beams, the wall dark, no beat. The beams keep a visibility floor (S5b): the 6 % is the haze's and the wall's level, the two beams are drawn at no less than the floor | As room-2d.md "Before the start" (gel lights down, class title, time in each zone) |
| Warm-up (zones 1 and 2) | Calm: few beams, slow sweep, a slow wave on the wall, shallow lift on the beat; the haze clearly blue or teal | Running layout |
| Each zone, 1 to 7 | Colour and energy from the table above | Running layout |
| Interval change coming (last 10 s) | Back truss and wall wipe to the next zone's colour from the far side, from the later of 10 s before the change and the previous change; the front truss stays | Label "Change in" in the last 5 s (room-2d.md); the next row is the next zone with its number and name, so the second colour on screen always has its number beside it |
| Interval change | (Built in #576 and #577.) The front truss, the floor uplights and the haze cross to the new colour in the 700 ms that end at the change, a wipe from the far side toward the gel, each light switching hue at constant luminance, never a mix; the new zone's energy arrives in one 700 ms ramp ending at the change ("Colour: two hues, never a mix"); the energy is in the change frame instead when a count runs, without the beat, or where a window over the ramp counts the looks' sway (to be built in #592, "The looks' sway, counted"); every lens flashes toward white once at the change (160 ms, `--m-flash`, under the flash threshold), unless a burst falls on the same moment, which then replaces it ("The flash budget", collisions) | New values, the gel's cut and the countdown's reset in **one frame** at the change (the gel never shows a mix); on the scene no white line down the gel's edge (#577; the lens flash marks the change) |
| Song change | Rig dims to 25 % for one beat, back on the first beat of the new song (built in #577: down in 120 ms and up in 120 ms; no dim when a burst or an interval change falls within 1 s, when a count runs or without the beat); the beams turn to the new song's look at no more than 30 degrees a second, so the turn is done within 3.5 s ("How a beam turns") | Score moves on; song clip and BPM change |
| Build (8 beats before a drop, or a `build` moment) | Beams turn, at the turn limit, to gather at one point in the middle of the room (complete in time up to about 170 bpm), the haze brightens (built in #577: a step up of 3 % on each beat, about 1.25 ×, with a lift of 2 %; as built, 1.5 × with a 55 % lift); for the last 1 s before the drop the haze has finished rising and the beams hold still where they are ("The flash budget") | Nothing new (the score shows the "Drop" tick) |
| Drop | One white burst over the whole scene (also at the None level, except paused, holding and off the list) (a peak of 0.85 of white at the drop, 250 ms decay; built in #577: up in one frame in the drop's fixed frame (the nearest interval change's, when one is under 1 s away, light only), at least 10 s from any other burst; skipped, and the fan's frame instead, where the window has no room: at the Beat level and at Tempo only (wherever the ramp runs), on an interval change (the ramp comes first) and with a count running; with the light-only bursts, the only full-screen flashes; the fan's extra fixtures come on in the burst's frame), then every fixture on, the beams' turn starting 650 ms after the drop (to be built in #592: 2250 ms after the drop's moment, whatever P1 merges; no turn for a drop less than 2.25 s before its song's end, as at 58 s) and going, at the turn limit, to the wide fan for 4 bars (as built, the fan is open within 4.2 s and 4 bars last 5.3 s even at 180 bpm; to be built in #592 it is open within 5.75 s of the moment and the fan's window lasts at least 6.75 s), then the zone's own energy | Unchanged; the text is never flashed (dark-under-text holds during the burst) |
| Breakdown | One slow beam on the front truss and the wall's wave for 8 bars | Unchanged |
| Paused | Lights down: everything to 6 %, frozen where it was | As 2D: gel lights down, "Paused" plate, link plate "Music paused" |
| Coasting (readings stopped or stale) | No beat at all (the beat cannot be measured); the rig keeps the zone's colour and moves at its energy | As 2D: "estimated", dimmed dashed countdown, link plate "Music not heard" |
| Playlist not loaded | The rig is as in the state the class is in: nothing in it changes for this notice, and no light or beam is used to say it | As 2D (room-2d.md "Playlist not loaded", #486, #520): in the link state's place, a white plate "Playlist not loaded" with the square marker, for 30 s after the first Start of the class, only when Start asked the music app to play, and never in place of a link fault ("Music not heard", "Not a class song", "Song is in twice", "Music paused"); the segment name is hidden while it shows; no motion, so reduced motion changes nothing. It takes the place of "Following Spotify" and "Waiting for the first song"; the presenter's own line is in presenter.md |
| Off the list | "Holding" look: no beat, movement halved, brightness 60 %, the song look of the interval's planned song, no moments (a gather, a fan or a breakdown does not run) | As 2D: link plate "Not a class song", BPM "Song, planned" |
| Position pattern, beat known | The zone's look, beams at full on "up" and 72 % on "down", an accent on each switch (the accent 5 % in place of that beat's lift, built in #577; built in #591: the step in one frame on the count tick that shows the switch) | Pattern block: side, beat count, beat squares, "then …"; the count steps on its ticks: the switch beat of each side, and any other beat at least 500 ms after the last mark and at least 500 ms before the next switch beat (so every beat up to 120 bpm; built in #591, text rule 2 and S14) |
| Position pattern, tempo only (no anchors) | Tempo pulse, no accent | `interval_start`: side and count at the bpm from the interval's start. `next_downbeat`: label and "Count from the music" |
| Position pattern before its first downbeat (`next_downbeat`) | As the zone | Side of the first entry and "starts on the next bar"; no count until the downbeat |
| Position pattern, no lock | No beat, no pattern accent | Pattern block: label and "Count from the music"; no side, no count |
| `pattern_without_bpm` (a pattern in a song with no `bpm`) | No beat, no pulse, no accent | Pattern block: label and "No tempo: count from the music"; the Song metric reads "Song, no tempo" and "–"; the score's strip is left out |
| No beat anchors (tempo only) | Tempo pulse of 4 % (12 % as built; #577), no wall chase, no phrase mirroring | No bars line; no phrase ticks in the score |
| No marked moments | Light-only bursts on the song's interval changes, at least 10 s apart (#577: from any burst; placed where the flash budget has room, at the None level, not at the Beat level and at Tempo only (wherever the ramp runs)) | No moment ticks in the score |
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
  brightness change of at most 4.5 % (2 % in a build, with the haze's step; built in #577,
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
| S3. Look-ahead | The score shows at least **5 minutes** ahead of "now" at every supported size (**8** at 16:9 and wider, **6** at 3:2 and narrower, to the screen's edge). Every interval of **40 s or more** starting within the labelled window (7 min at 16:9, 5 min narrower) shows its **number and its length**; any block that cannot show its number shows no zone colour. The **next interval's number, name, length, targets and cue are always on screen in the next row**, whatever the score shows; the next interval shown is the next one that is not merged away ("The flash budget", text rule 2) |
| S4. Visible at once | All nine content items in every running state, with the band hidden, at every supported size |
| S5. Zone | The zone is a number and a name as well as a colour on the gel, the next row and the score (as C5); a score block never shows its colour without its number. The rig shows only the current zone's colour, the next zone's colour during the 10 s anticipation (while its number and name are in the next row; the next interval not merged away, "The flash budget", text rule 2), and white. A merged-away interval's token is not allowed. Never another hue, never a measured heart-rate zone (rule 7). A token keeps its hue at any lightness and any share of white: in linear light every rig pixel is `a × T + w × white` for one allowed token `T`. Tested on the rendered pixels of every frame of the S6 runs, 0 failing pixels ("Colour: two hues, never a mix", the test) |
| S5b. House-look beams | In the before-the-start state each of the two beams has a core of at least **0.006** relative luminance (about 18 of 255 in sRGB), at least **15 code values** above the haze beside it on the channel of the token's strongest primary, and the same at every render scale; the haze and the wall stay at the 6 % level. Beams at the plain 6 % measured about 0.0017 over 0.0006 (3 to 4 codes) and do not read at room distance; the floor is a fixed level, not a share, so it is the same colour at every size. The beams still carry one token and white only (S5), do not move faster than S7, and add no beat (S8). Checked on the CI screenshot of the state at every room size |
| S6. Flashes | No region larger than 10 % of the screen changes in relative luminance by more than 10 % more than 3 times in any second; the drop burst and the light-only bursts count within that limit. At most one full-screen burst per drop moment (or per interval change in a song without moments), at least 10 s apart, placed where the scheduler has room for it: the gate asserts at least one white burst at 40 s (None level), 58 s (both levels) and 80 s (None level), and a drop on an interval change at the Beat level and at Tempo only (wherever the ramp runs) has none (the ramp comes first). Measured as "The flash budget" says (every region of at least 10 %, each direction a change, no duration gate, any sliding 1 s), locked with the beat and in every other state; **the gate on the real running states, locked with the beat, is the authority**. Built in #577 for the scene's canvas, the design that meets it: beat-like light at most 5 % per run in every region, and at most 3 counted changes in any 1 s, steady light counted as one in every window (every step a frame mark at least 500 ms apart, so at most 2). The whole frame, text layer included, has been gated since #591 ("The text layer on the scheduler, as built"). **To be built in #592** ("Steady light and sweeps"): steady light gated per region at **3 %** in any 1 s outside the sweeps' windows, locked and coasting; every sweep (any span in which a beam's drawn direction is not on its target, whatever changed it) counted as **1** over its window of at most **4.15 s** per turn of class-clock time, with no run in it and no exception (after a seek or a jump, a reload, a lost lock, a regained lock or a resume the beams hold their aim and steady light is held still for 2 s, the run in progress ends in the cause's frame, and no run ends less than 1 s before the turn); a CI check over a generated matrix (every look, zone row, phrase parity, tempo of 60, 90, 120, 150, 180 and 200 bpm and quality level, overlap offsets in steps of at most 250 ms, and every cause) fails above 1 or on a cause with no case; the gate holds a moment with each mark type inside each sweep cause, and each unforeseen cause with a run in progress and with a run just ended, each holding 3. **This rule and the strict whole-frame gate are not changed by #592** and stay the authority: every gated run must still pass them |
| S7. Movement | The camera never moves. No beam turns faster than 30 degrees a second **on any frame**, a re-aim, a phrase flip and a moment included: the drawn direction follows the model's target through a turn-rate limiter ("How a beam turns"). Rule 4: a beam's direction is a function of the song's look, the fixture, the motion phase, the phrase and the song's moments only. Test (scene model): two classes that differ only in their intervals (zones, targets, positions, patterns, cues), evaluated at the same song, look, phrase, moments and **motion phase**, with the same user actions and link events at the same times, give every beam the same direction (the 2 s hold after an unforeseen cause depends only on the cause's time, "How a beam turns", item 1); and the motion phase's rate depends only on the zone's row, at most 30 degrees a second. Light-only bursts on interval changes change no direction |
| S8. Beat | Beat lift, wall chase, phrase and pattern accent only at the **Beat** level (lock, `bpm` and anchors), within 50 ms of the anchor beat (spike 1's criterion). At **Tempo only** a pulse of at most 4 % (built in #577; 12 % as built) and the pattern count of S14 (at the `bpm` from the interval start, `start_on: "interval_start"` only), and nothing else beat-like. At **None** (paused, coasting, off the list, manual clock, holding, no `bpm`) no lift, pulse or accent. No downbeat is ever guessed |
| S9. Frame rate | ADR 0009's re-check: at the **default quality level (High)**, on a studio-class computer at 1920 × 1080, a **median of at least 58 fps over a full class** and **no second under 30 fps**, from the frame-rate log (once a second, with the quality level). A class that steps down from High misses this criterion; the steps of the table above only keep the room usable on a weaker computer |
| S10. Fallback | Scene killed: the plain 2D screen within 2 s, the clock continuous (plan section 9) |
| S11. Reduced motion | With reduced motion the room shows the plain screen; a still-rig screenshot shows no change between two frames 1 s apart except the score's one-second step, the countdown and the pattern count |
| S12. Hue in the text layer | As C6: hue only on elements that stand for a zone |
| S13. Intervals first | Every interval is its own block in the score: a test class with three intervals inside one song shows three blocks, each with its number, in the look-ahead window. A song clip never hides, merges or reorders interval blocks |
| S14. Pattern count | In an interval with a pattern and a known count (Beat level; or Tempo only with `start_on: "interval_start"`), the side and the count are on screen at all times; at the Beat level the count steps within **50 ms** of the anchor beat (as S8), on the count's ticks, which are at least 500 ms apart (built in #591; "The flash budget", text rule 2): every beat up to 120 bpm; above it the switch beat and the beats at least 500 ms from the last tick and from the next switch beat, the rest dropped (latest value wins); the count reaches the next side exactly on the switch beat whenever sides are at least 500 ms long, and with shorter sides on the first switch beat at least 500 ms after the last frame mark whose side differs from the one shown; near a fixed frame or a user action a count tick may be late by up to one tick period, join the fixed frame or be dropped (P2) ("The flash budget"); the next side is named (also for three- and four-entry patterns). Otherwise no side and no count is shown and the block says why. Every pattern starting in the look-ahead window shows its words in the score or the next row |
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
| `--scene-burst` | 0.85, decay 250 ms | The burst's peak share of white (peaking at the moment) and its decay, as built |
| `--scene-burst` rise | One frame (built in #577) | The burst goes up to its peak in one frame |
| `--scene-anticipate` | 10 s | How long before an interval change the next colour comes in |
| `--scene-turn-max` | 30 degrees a second | The fastest any beam turns; the limiter's rate (S7) |
| `--scene-reaim` | 3.5 s at most | The longest a re-aim, phrase flip, gather or fan may take: the largest target step of 105 degrees at the turn limit. Replaces the 1.2 s of earlier revisions, which names nothing now (the song-change dim is one beat). With `TURN_DELAY_MS` it sets `--scene-sweep-window` |
| `--scene-sweep-window` | 4.15 s (to be built in #592; 2.5 s as built in #577) | The longest a sweep's window lasts **per turn**, in class-clock time: `--scene-reaim`, 3.5 s, plus `TURN_DELAY_MS`, 650 ms; overlapping turns are one sweep, which may last longer. It starts on the turn's first frame and ends when the drawn directions are on their targets (a gather's where the beams hold still); a foreseen one is planned for the full 4.15 s. No run overlaps it, with no exception (an unforeseen cause's turn starts after `--scene-unforeseen-hold`), and the scheduler counts the sweep as 1 in every 1 s window that overlaps it ("Steady light and sweeps") |
| `--scene-unforeseen-hold` | 2 s of class-clock time (to be built in #592) | After a seek, a 15 s jump, a reload, a lost or regained lock or a resume, every beam keeps its present aim this long and steady light is held still, then the beams turn at the normal rate: P2's longest lateness, 1 s, plus 1 s. The run in progress ends in the cause's P2-placed frame, and no run ends less than 1 s before the turn. Shortened only if the scheduler's property test still holds at 3 ("How a beam turns", item 1) |
| `--scene-sweep-max` | 1 counted change in any 1 s (to be built in #592) | What the scheduler counts for every sweep, and the most changes the strict measure may find in any 1 s of one (overlapping turns are one sweep); a CI check over the generated matrix, locked and coasting, fails above 1 or on a cause with no case. A case the light levers cannot bring to 1 stops #592 and goes to the Orchestrator |
| `--scene-sway-max` | 1 counted change in any 1 s (to be built in #592) | What the scheduler counts for the looks' sway in every 1 s window that overlaps a live span (one 1 with steady light's and a sweep's), and the most changes the strict measure may find in any such 1 s; a CI check over the generated matrix, locked and coasting, fails above 1 or on a look or a sweep cause with no case. A case the light levers cannot bring to 1 stops #592 and goes to the Orchestrator |
| `--scene-lift-max` | 3 per second | The beat lift's highest rate |
| `--scene-lift-cap` | 0.05 (built in #577) | The largest run any beat-like light (lift, pulse, accent, wall chase, the build's haze step, lens flash) may make alone in any region, as a share of its larger end (S6) |
| `--scene-steady-max` | 3 % a second, per region (to be gated in #592, built to 2.5 %; the haze's drift and the wall's wave alone measured 2.3 to 2.6 % on main) | The most **steady light** (the haze's drift, the wall's slow wave, not the looks' sway at rest, which is counted (`--scene-sway-max`) and bound by S7 and the strict gate, and not the beams' turns, which are sweeps) may move any region of the strict gate in any 1 s, and in one beat below 60 bpm, with only the one-frame jumps on frames the scheduler's log names as marks taken out (any other jump over 2 % fails), outside the sweeps' windows, locked and coasting; where the rig gives a region less than 8 % of its light, 3 % of the rig's own light there ("Steady light and sweeps", S6) |
| `--scene-hold` | 250 ms before, 300 ms after (built in #577) | Beat-like light held at rest around a scheduled run (S6) |
| `--scene-lens-flash` | 0.25 over 0.5 at rest (built in #577) | The white share the lens flash adds to a lens, which is 0.5 white at rest; lowered if a region would pass `--scene-lift-cap` |
| `--scene-tempo-pulse` | 0.12 | The tempo pulse's depth when there are no anchors, as built |
| `--scene-tempo-pulse` (to be built) | 0.04 (built in #577) | Its depth within the flash budget; replaces 0.12 |
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
