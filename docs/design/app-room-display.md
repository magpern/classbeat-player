# Screen spec: the room view on an external display

Status: proposed in the pull request for issue #628, for [ADR 0011](../adr/0011-the-phone-app-is-built-with-capacitor.md)
section 2 ("an external display"). Overview and checks: [app.md](app.md). The room view is
[room-2d.md](room-2d.md)'s, unchanged, but the app's display no longer shows it (issue #871, as
built in #880). Mock-ups: `mockups/app-display-idle.html` and `app-display-idle-rider.html` (1920 × 1080 and
1280 × 720 each) and `app-display-lost.html` (the phone).

## Purpose

When the phone or tablet is connected to a screen (HDMI, USB-C, or a cast that Android presents as
a display), the screen shows the idle stage in every mode, and the phone keeps the class screen
and its band. A class run on the phone in instructor mode is the phone's room screen (app.md,
"The room screen on the phone"); the display does not mirror it. The display never shows the
riders' list or anything of the instructor's (ADR 0007 section 4).

## Content, in priority order

On the display:

1. Instructor mode, any page, a class open on the phone included: the dark stage and one line in
   the middle, "The class shows here when it opens on the phone", at the room's text tier. The
   app's display policy no longer allows the room screen, and the display's page loader refuses
   `/room.html`. No band, no keys, no pointer: the display is watched, not touched.
2. Rider mode, any page: the same stage and one rider line, "Your class is on your phone" (see
   "The rider's idle line").

On the phone, while a display is connected: the class screen as in app-follow.md, unchanged.

## When the display shows what (issue #752)

While a display is connected and the app is in the foreground, the display always shows a page of
the app's own, so Android never mirrors the phone's screen onto it:

| Phone | Display |
|---|---|
| Instructor mode, a class open or running on the phone | The idle stage: the display keeps it while the class runs, never the room screen |
| Instructor mode, any other page | The idle stage |
| Rider mode, any page, a joined class included | The idle stage: never the room screen, nothing of the rider's |
| Between modes (a switch, a native screen) | The idle stage |
| The app in the background | Nothing: the app presents only while it is in front, and the display shows what the system shows |

The idle stage is the same page in every mode; only its one line differs: the instructor line in
instructor mode and between modes, the rider line in rider mode (next section). The display shows
nothing of the rider's, so that no rider data can reach it.

If the display's page stops working (its web view's render process dies), the app presents it once
more. If it stops a second time for the same display, page and mode, the display stays as the system
leaves it until one of the three changes. The phone is not affected either way.

## The rider's idle line (issue #759)

In rider mode the display shows the idle stage with this line, in place of the instructor line:

> Your class is on your phone

Why this line. A rider joins a class on the phone, so the instructor line ("The class shows here
when it opens on the phone") promises a room view that never comes in rider mode. The rider line
is true on every rider page, before and after joining, so it needs no knowledge of what the rider
is doing and carries nothing of it. It has no number, name, nickname, class title, zone, rider
count, join code or sensor reading (plan rule 13); it is a fixed string, chosen by the mode alone.

Presentation: the same as the instructor line. The room's text tier (data-tier "text", font size 6 % of the
screen height, capital height at least 3 %), the font of the room's text, `--light-2` on `--stage` (contrast
about 11 : 1, minimum 7 : 1), centred, at most two lines and 70 % of the width, inside the room's 5 %
safe area. At 1920 x 1080 the text is 65 px high; at 1280 x 720, 43 px: readable from across the
room. Nothing else is on the stage: no icon, no picture, no motion, so there is no reduced-motion
form. The text is real text, never in a picture.

Wording: "phone" as in the instructor line; no "tablet" variant. The line is for a viewer in the room,
not a button, so it has no verb of the rider's.

The build is a separate pull request: the idle stage takes its line from the mode, and a test
covers both lines.

## Layout

The idle stage is checked at its own size: 1920 × 1080 the reference, 1280 × 720 the smallest
checked, and a display squarer than 16 : 10 keeps the same centred line. The phone's own layout
does not change.

## States

| State | Mock-up | What shows |
|---|---|---|
| Display, no class open | `app-display-idle` | The idle line |
| Display, class open or running on the phone | `app-display-idle` | The same idle stage and line; the room screen is not shown on the display |
| Display, between modes | `app-display-idle` | The instructor idle line, as with no class open |
| Display, rider mode, any page or a joined class | `app-display-idle-rider` | The rider idle line, "Your class is on your phone" |
| Display gone during a class | `app-display-lost` | The phone goes on as it was; for 30 s its link slot says "Room screen disconnected" in white, then the clock's usual words. Reconnecting shows the idle stage again with no question |

## Motion and reduced motion

The idle stage has no motion. app.md's on the phone.

## Wording

"room screen" for the display, as in room-2d.md.

## A running class (issue #769, ADR 0015)

The display stays on the idle stage while a class runs, so it shows no incline target either; the
phone's room screen shows it as the room screen does ("A running class"; mock-ups `runclass-room*`).
In rider mode the display stays on the idle stage, so no treadmill or foot-pod reading can reach
it (ADR 0015 section 5).

## Rules (plan section 3)

| Rule | How these screens keep it |
|---|---|
| 7. Colour means the planned zone | The idle lines are grey on the stage; no zone is shown on the display |
| 12. No camera | None |
| 13. Rider data one way | The display never shows the riders' list, a count of riders or a nickname; in rider mode it shows only the idle stage with a fixed line, never the rider's own screen |
| 15. No team games | None |

## Open questions

None.
