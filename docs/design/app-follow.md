# Screen spec: following the music in the app

Status: proposed in the pull request for issue #628, for [ADR 0011](../adr/0011-the-phone-app-is-built-with-capacitor.md)
section 6. Overview, sizes and checks: [app.md](app.md). The class screen is `/play`'s
([play.md](play.md)) with the room's link words ([room-2d.md](room-2d.md)). Mock-ups:
`mockups/app-follow-*.html` and their `-390x844.png` and `-844x390.png` shots.

## Purpose

Let the instructor have the class follow Spotify on the phone, ask for Android's Notification
access only at that moment, say plainly why and what is read, and make the manual clock an equal
answer rather than a failure. Instructor mode only: rider mode never asks and never follows.

## Content, in priority order

On the class screen (a class open, instructor mode):

1. Everything of play.md's "Visible at once", unchanged: the gel's number and name, the link slot,
   the countdown, the metrics, the cue, the next row, the band or the score.
2. In the **link slot**, the room's words for the clock: "Press Start" or "Manual clock" (grey,
   square marker) while the clock is manual; "Waiting for the first song" once following is on.
3. In the band, **Follow the music** (word "Follow", under it "The music"), at the band's left,
   apart from the transport and End. It is there only while the clock is manual and following could
   be turned on; once following is on, it goes. It is a key of the band, so it shows when the band
   shows (play.md, "Controls and keys").

On the **follow sheet** (native, over the class screen):

1. Mode tag "Instructor mode", title "Follow the music on this phone".
2. What it does: "When a song starts, pauses or moves on, the class clock goes with it."
3. What is read, in grey: "Only Notification access lets an app see what Spotify plays. The player
   reads Spotify's song, play or pause and position only: no other notification, no message."
4. Keys, stacked: "Open the setting" (main: opens Android's Notification access list for the app)
   and "Not now: manual clock".

## Layout

| Size | Class screen | Follow sheet |
|---|---|---|
| Phone portrait | play.md's portrait layout. The band takes two rows: Follow alone and full width on the first, the transport and End on the second; the band's box grows to hold both (at least 156 px) and the cue gives up the height | One column; the keys at the end |
| Phone landscape | play.md's small landscape: Follow at the band's left, the transport in the middle, End at the right, one row | Two columns: the words at the left, the keys at the right |
| Tablet | play.md's tablet layouts | As the phone in the same orientation |

## States

| State | Mock-up | What shows |
|---|---|---|
| Before the start, no access | `app-follow-before` | The link slot "Press Start"; the band with Follow, Previous, Start, Next, End |
| The sheet | `app-follow-ask` | As above. Back or "Not now" closes it; the class stays on the manual clock and Follow stays in the band |
| Back from the setting, still off | `app-follow-still-off` | The sheet's title becomes "Notification access is still off", with three steps: open the setting; find classbeat and turn it on; if Android says restricted: App info for classbeat, three dots, Allow restricted settings. Same keys |
| Access given, before the first song | `app-follow-waiting` | The sheet closes by itself; the link slot "Waiting for the first song"; Follow is gone |
| Following, running | (play.md and room-2d.md's link states) | The link slot follows room-2d.md: the song, coasting, re-locking, with Undo where the room shows it |
| Access taken away during a class | `app-follow-lost` | The clock goes on by hand at once. For 30 s the link slot says "Following stopped" in white (room-2d.md's hand-over), then "Manual clock". No plate, no sound: nothing is wrong |
| Running on the manual clock | `app-follow-manual` | The link slot "Manual clock"; the band with Follow, Previous, Pause, Next, End. Follow opens the sheet again |

**Start with a playlist stays off.** ADR 0001 (amendment, #486) lets Start ask Spotify to play the
class's playlist. In the app it is off until a phone run shows it works (ADR 0011, amendment of
2026-11-24). So Start never opens a `spotify:playlist:` link: it plays what Spotify has loaded, and
the class screen shows room-2d.md's white plate "Playlist not loaded" for every class, with or
without a playlist in it. Nothing in the follow sheet or the band offers a playlist; this spec adds
no key or word for it. When a phone run shows it works, a later spec change turns it on.

The sheet never opens by itself: only Follow opens it. Access is asked for once per press, never at
start-up, never in rider mode, never with no class open.

## Motion and reduced motion

The sheet fades in over 200 ms; with "Remove animations", at once. The class screen's motion is
play.md's.

## Wording

- "Follow the music" for turning following on; "Manual clock" for the clock without it; Android's
  own names for "Notification access", "App info" and "Allow restricted settings".
- The sheet says what is read in plain words and nothing about other apps.

## Rules (plan section 3)

| Rule | How these screens keep it |
|---|---|
| 3. Spotify's music stays in Spotify's app | The app reads Spotify's session only: song, playing or paused, position; no audio |
| 7. Colour means the planned zone | Hue only on the gel, the next chip and the score's blocks, each with its number and name; the sheet, Follow and the link words are white and grey |
| 12. No camera | None |
| 13, 15 | No rider on these screens; instructor mode only |

## Open questions

- The restricted-setting words on the owner's phone (app.md).
- Follow on the class list as well (app.md).
