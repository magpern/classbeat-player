# Screen spec: the room view on an external display

Status: proposed in the pull request for issue #628, for [ADR 0011](../adr/0011-the-phone-app-is-built-with-capacitor.md)
section 2 ("an external display"). Overview and checks: [app.md](app.md). The room view is
[room-2d.md](room-2d.md)'s, unchanged. Mock-ups: `mockups/app-display-idle.html` (1920 × 1080 and
1280 × 720) and `app-display-lost.html` (the phone).

## Purpose

When the phone or tablet is connected to a screen (HDMI, USB-C, or a cast that Android presents as
a display), the screen shows the room view for the class open on the phone, as the desktop's room
window does, and the phone keeps the class screen and its band. The display never shows the
riders' list or anything of the instructor's (ADR 0007 section 4).

## Content, in priority order

On the display:

1. A class open: room-2d.md's room screen, with the room's tiers, the room's 5 % safe area and the
   zone always as a number and a name as well as its colour. No band, no keys, no pointer: the
   display is watched, not touched.
2. No class open: the dark stage and one line in the middle, "The class shows here when it opens
   on the phone", at the room's text tier.

On the phone, while a display is connected: the class screen as in app-follow.md, unchanged.

## When the display shows what (issue #752)

While a display is connected and the app is in the foreground, the display always shows a page of
the app's own, so Android never mirrors the phone's screen onto it:

| Phone | Display |
|---|---|
| Instructor mode, a class open | The room screen |
| Instructor mode, any other page | The idle stage |
| Rider mode, any page, a joined class included | The idle stage: never the room screen, nothing of the rider's |
| Between modes (a switch, a native screen) | The idle stage |
| The app in the background | Nothing: the app presents only while it is in front, and the display shows what the system shows |

The idle stage is the same page in every mode, with the same line: a class opens on the phone only
in instructor mode, so the line holds in rider mode too.

If the display's page stops working (its web view's render process dies), the app presents it once
more. If it stops a second time for the same display, page and mode, the display stays as the system
leaves it until one of the three changes. The phone is not affected either way.

## Layout

The display uses room-2d.md's layouts at its own size: 1920 × 1080 the reference, 1280 × 720 the
smallest checked. A display squarer than 16 : 10 uses the room's 4 : 3 layout. The phone's own
layout does not change.

## States

| State | Mock-up | What shows |
|---|---|---|
| Display, no class open | `app-display-idle` | The idle line |
| Display, class open | room-2d.md's room mock-ups | The room screen, every state of room-2d.md |
| Display, rider mode or between modes | `app-display-idle` | The idle line, as with no class open |
| Display gone during a class | `app-display-lost` | The phone goes on as it was; for 30 s its link slot says "Room screen disconnected" in white, then the clock's usual words. Reconnecting shows the room view again with no question |

## Motion and reduced motion

room-2d.md's on the display; app.md's on the phone.

## Wording

"room screen" for the display, as in room-2d.md.

## Rules (plan section 3)

| Rule | How these screens keep it |
|---|---|
| 7. Colour means the planned zone | room-2d.md's; the idle line is grey on the stage |
| 12. No camera | None |
| 13. Rider data one way | The display never shows the riders' list, a count of riders or a nickname; in rider mode it shows only the idle stage, never the rider's own screen |
| 15. No team games | None |

## Open questions

None.
