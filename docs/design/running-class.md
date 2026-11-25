# Screen spec: the running class, and treadmill and foot-pod readings

Status: proposed in the pull request for issue #769, for PL10 (plan section 12) and
[ADR 0015](../adr/0015-running-classes.md) sections 2 and 4. This extends the design system
([system.md](system.md)); it is not a new visual direction. Where this spec and ADR 0015 differ,
the ADR wins. Reference mock-ups and screenshots: [mockups/](mockups/), files `runclass-*.html`
with `-<w>x<h>.png`, styled by [runclass.css](mockups/runclass.css) on top of the existing
room, play, companion, rider and sensors styles. **Where a mock-up and this text differ, the text
wins.**

Settled in issue #769, not reopened here: the zone is a number, a name and a colour; the incline
target is text ("Incline raised", "Incline flat"); a running class has no cadence gauge and no seated
or standing cue; the scene keeps its light-only look and nothing in it moves with speed or incline;
the rider page's readings are speed (km/h), incline (%) and a foot pod's cadence (steps a minute),
as numbers only, with no gauge and no colour by value; a reading older than 3 s is missing.

## What a running class changes

A class with `sport` `running` (ADR 0015 section 1) has per interval the zone, its name, its cue
and `incline` (`flat` or `raised`). It has no cadence, position, pattern or test. Against a cycling
class, every screen changes in the same three ways and in no other:

1. **The incline target replaces cadence and position.** Where the cycling screen has the Cadence
   and Position metrics, the running screen has one metric: label "Target", value
   **"Incline raised"** or **"Incline flat"**, in the same value tier (`--t-value` on the room
   screen, the metrics' own size on `/play`). Items 3 of room-2d.md's "Content" (cadence and
   position) and the cadence and position of the next row become the incline target. A running
   interval has no position pattern, so the pattern forms never occur.
2. **Nothing else is added or moved.** The countdown, the zone, the song's BPM, the cue, the next
   row, the score, the rail, the link states, the band and every state of room-2d.md and play.md
   stay as specified. The next row reads "Next [zone] name length Incline flat".
3. **The zone targets are those the class's `zone_scale` has** (room-2d.md, "Content" item 2):
   the mock-ups show %HRmax and RPE; a running scale without %FTP shows no %FTP.

The incline target is **text only**: no icon, no slope drawing, no arrow, no gauge, no colour
other than white (rule 7). It is never baked into a picture. The zone colour stays on the gel, the
next chip and the score, as ever.

## The room screen and the plain screen

| Screen | State | What shows | Mock-up |
|---|---|---|---|
| Room screen ([room-2d.md](room-2d.md)) | Running class, incline raised | Items 1 to 9 of "Content", with the incline target as item 3, in every size of room-2d.md | [html](mockups/runclass-room.html), [1920 x 1080](mockups/runclass-room-1920x1080.png), [1440 x 1080](mockups/runclass-room-1440x1080.png), [1280 x 720](mockups/runclass-room-1280x720.png), [1280 x 800](mockups/runclass-room-1280x800.png), [1024 x 768](mockups/runclass-room-1024x768.png) |
| Room screen | Running class, incline flat | The same with "Incline flat"; the next row says "Incline raised" | [html](mockups/runclass-room-flat.html), [1920 x 1080](mockups/runclass-room-flat-1920x1080.png) |
| Plain screen, `/play` ([play.md](play.md)) and the app's class screen ([app-follow.md](app-follow.md)) | Running class, incline raised and flat | play.md's "Visible at once" with the incline target | [raised](mockups/runclass-play.html), [flat](mockups/runclass-play-flat.html); shots at 390 x 844, 844 x 390, 360 x 640, 640 x 360, 768 x 1024 and 1024 x 768 |
| App external display ([app-room-display.md](app-room-display.md)) | Running class | The room screen above, unchanged; the idle stage is unchanged | the room mock-ups |

Every other state of those specs (before the start, paused, holding, link plates, the band, the
join sheet, End asked, Class Complete) is unchanged for a running class: it has no cadence or
position to show in any of them.

**Size.** "Incline raised" is 4.88 em wide in the value face, wider than "On the beat" (4.24 em).
On the room screen at 3:2 and wider, where the metrics column is 38 vh wide, it is set at **7.4 vh**
(cap height **6.0 %** of the screen height; 65 px at 1080, 43 px at 720), and it ends 1.9 vh inside
the column. At 3:2 and narrower the row's own size min(7.4 vh, 5.55 vw) already holds it. On `/play`
held upright the column beside the gel is about 160 px wide on a phone, so the value breaks at its
space into two lines, "Incline" over "raised", at the metrics' own size (3.7 % cap height); in every
other `/play` layout it is one line. The second line costs the metric one line height, which the
column has (the cycling column holds three metrics; this one holds two).

## The rider page: the class view

The page of [rider.md](rider.md) in a running class: the gel, the countdown, the effort rows the
zone has (heart rate and RPE in the mock-ups), the next rows and the keys. **No position** and **no
cadence target**. The incline target is text in the clock's right-hand slot where the cycling page
has Position: label "Target", value "Incline raised" at the value tier (3.7 % / 6.7 % of the
viewport height, portrait / landscape).

**Contract gap G1 (not decided here).** `rider_state` and `companion_state` carry no incline today,
and the plain word "incline" is on the rule guards' word list (companion.md, "Contract gaps"). The
mock-up shows the slot filled, as it would be with a field. Until the contract lane adds one,
through the route companion.md describes and with every guard list unchanged, the slot is empty
exactly as it is for a null position, and the rest of the page is as mocked. The handlebar
companion ([companion.md](companion.md)) shows nothing of cadence, position or incline today and
is unchanged for a running class ([mock-up](mockups/runclass-companion.html)): the cue carries what
the author wrote.

## The readings: treadmill and foot pod

Rider page only, to that rider only, in memory only, sent to no one (ADR 0015 section 5; the
instructor's panel, the room strip and the app's rider mode stay "unavailable" until the owner
decides, ADR 0012 section 6). They sit in the effort block under the plan rows, after RPE, on the
page's existing keys: **Connect a sensor** when none is connected, **Sensors** when one is
([sensors.md](sensors.md) governs the sheet, the plates and the lost state, unchanged).

| Row label | Value | Unit | Source | Shown when |
|---|---|---|---|---|
| Speed | One decimal ("9.5") | km/h | Treadmill Data, else a foot pod | a connected sensor gives speed |
| Incline | One decimal ("1.0") | % | Treadmill Data | the treadmill's data carries an inclination |
| Cadence | Whole number ("164") | steps/min | A foot pod | a foot pod is connected |

- **A row only for a measure a connected sensor gives.** No cadence row without a foot pod; no
  incline row for a treadmill that sends none. A measure with two sources uses the first connected
  ([sensors.md](sensors.md), "What a reading is"). Total distance is never shown (rule 4).
- **Numbers only.** One line per reading: the label, then the number and its unit. No gauge, no
  bar, no tick, no ring, no arrow, no trend. The number and its unit are white (`--light-1`) and
  grey (`--light-2`); **a reading never takes a colour**, inside or outside any range (rules 7, 8).
  The class's incline is "raised" or "flat", not a number, so a reading is not set against it.
- **Missing.** A reading with no value for more than 3 s shows a grey dash "–" (`--light-2`) with
  its unit kept, never the last number. A shown reading changes at most once a second, as a step.
- Units are words the rider knows: "km/h", "%", "steps/min". No pace, no advice (rule 8).

| State | What shows | Mock-up |
|---|---|---|
| No sensor | The class view; the key says "Connect a sensor"; no reading rows | [html](mockups/runclass-rider.html), [390 x 844](mockups/runclass-rider-390x844.png), [844 x 390](mockups/runclass-rider-844x390.png) |
| Treadmill and foot pod, live | Speed, Incline, Cadence as numbers | [html](mockups/runclass-rider-readings.html), [390 x 844](mockups/runclass-rider-readings-390x844.png), [844 x 390](mockups/runclass-rider-readings-844x390.png), [360 x 640](mockups/runclass-rider-readings-360x640.png), [640 x 360](mockups/runclass-rider-readings-640x360.png) |
| Readings missing | Each of the three: a grey dash and its unit | [html](mockups/runclass-rider-missing.html), [390 x 844](mockups/runclass-rider-missing-390x844.png), [844 x 390](mockups/runclass-rider-missing-844x390.png) |
| Treadmill only | Speed and Incline; no Cadence row; target "Incline flat" | [html](mockups/runclass-rider-treadmill-only.html), [390 x 844](mockups/runclass-rider-treadmill-only-390x844.png), [844 x 390](mockups/runclass-rider-treadmill-only-844x390.png) |

A sensor that is lost, refused or unsupported uses sensors.md's plates and words; the reading rows
show dashes. **Fitting:** as sensors.md ("Fitting"), the next rows give way (three, two, one) before
anything else; the effort rows, the readings, a plate and both keys never go.

## Measurable criteria

Measured on the mock-ups with headless Chromium (cap height = font size times the face's cap ratio,
0.813 for Big Shoulders and 0.667 for Atkinson, the ratios of system.md's table). The real screens'
CI screenshots are held to the same numbers, every floored text at least 5 % over its floor.

| Check | Requirement | Mock-up result |
|---|---|---|
| RC1. Incline target, room | Cap height at least **5.5 %** of the screen height at every size, and one line | 6.0 % at 1920 x 1080, 1280 x 720, 1280 x 800, 1440 x 1080 and 1024 x 768 |
| RC2. Incline target, `/play` | At least the metrics' own tier: **3.7 %** portrait, **6.0 %** landscape; never under 21 px portrait, 22 px landscape | 3.7 % (32 px) at 390 x 844, 3.7 % (24 px) at 360 x 640, 6.0 % (23 px) at 844 x 390, 6.0 % (22 px) at 640 x 360 |
| RC3. Incline target, rider page | The value tier of rider.md R1: **3.4 % / 6 %**, 21 px | 3.7 % / 6.7 % |
| RC4. Readings | The sensors.md `read` tier: **4.6 % / 7.4 %**, 29 px; units at the next-row tier (1.9 % / 3.4 %) | 5.6 % (48 px) / 8.9 % (35 px); at 360 x 640 5.9 % (37 px); at 640 x 360 8.9 % (32 px); units 2.0 % / 3.7 % |
| RC5. Contrast | At least **7 : 1** for every text: white 19.1 : 1, units 10.8 : 1, labels 7.2 : 1 on black; the gel's ink on its zone 16.6 : 1 for zone 4, and at least 7 : 1 on every zone gel (system.md) | all met; a missing reading's dash is `--light-2`, 10.8 : 1 |
| RC6. The zone | Number, name and colour together: the gel and every next chip carry the number; the gel and next row carry the name; the zone's colour is on the zone only | present in every mock-up |
| RC7. Visible at once | Room and `/play`: the nine items of room-2d.md (the incline target for item 3). Rider: rider.md R11 and every reading row and both keys | no scroll, nothing outside the screen, no two texts overlapping, in every mock-up above |
| RC8. Nothing running-specific moves | No element moves, fades or flashes with speed, incline or a reading; the flash budget of room-2d.md (S6) is unchanged, and reduced motion changes nothing here, since nothing here is animated | no transition or animation in `runclass.css` |
| RC9. Hue | Hue only in an element that stands for a zone. The incline text, the readings, units and dashes are white or grey | measured by eye on the shots; the CI check of sensors.md S5 applies |
| RC10. Touch targets | As rider.md R4: at least 64 x 64 px, 12 px apart | 390 x 844 and 844 x 390 |

## What this adds never shows or does (plan section 3)

No cadence gauge, seated or standing cue, track, map, route, distance, pace line or avatar (rules
4, 5). No scene input from speed, incline or any reading; the scene's inputs are the same for a
running class as for a cycling one, and the scene keeps its light-only look (scene.md). No colour by
a reading (rule 7). No command to the treadmill: the page connects, subscribes to notifications
and decodes (rule 2). No reading leaves the rider's phone (rule 13). The class is displayed, not
steered by any reading (rules 1, 3). No text is baked into a picture, and the zone is always a
number and a name as well as a colour.
