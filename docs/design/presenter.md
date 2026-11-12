# Presenter window: wording

Status: proposed in the pull request for issue #78. The presenter window's full spec comes with
PL5. Until then, this file sets one convention for its words, because the player already shows
them (design notes on #65 and #69). Mock-up: [mockups/presenter.html](mockups/presenter.html)
([1280×800](mockups/presenter-1280x800.png)).

## One convention

- **Sentence case** for every status line, link line and control: a capital first letter, then
  lower case except names ("Spotify"). No line is all lower case, no Title Case, no full stop at
  the end.
- **Plain words, not internal state names.** The window never shows `Locked`, `Coasting` or
  `ready`. It says what is happening, in the same words as the room screen's plate wherever both
  mean the same thing.
- **One line, one fact.** Details go on a second, grey line (`.detail`), never in brackets after
  a status.
- **Controls say what the press does.** A control that hands the clock over from the music
  says so in brackets: "(stops following)". This is the one place brackets are used.

## Clock line

| Clock (ADR 0001) | Line |
|---|---|
| Ready, not started | Ready |
| Running | Running |
| Paused | Paused |
| Held at the end of a song's window while the music plays | Holding at the end of the song |
| Ended | Ended |
| Ended while the last song plays on | Ended, holding at the end |
| Following just stopped because a control moved the clock | Manual clock, following stopped |

## Music link line

The same words as the room screen's plates (room-2d.md, "Link plates"):

| Link state (ADR 0001) | Line | Room screen |
|---|---|---|
| Locked | Following Spotify (the music app's name) | Same, in grey |
| Before the first lock | Waiting for the first song | Same |
| Paused | Music paused | Plate |
| Coasting | Music not heard | Plate |
| Off the list | Not a class song | Plate |
| Ambiguous | Song is in twice | Plate, with "Which one is playing?" and the choices on the presenter |
| Manual | Manual clock | Same, grey with a square marker |
| Manual, before the start | Press Start | Same |

Two lines in the player today are worded differently and change to the convention when the
presenter is built: "manual clock: following stopped" becomes "Manual clock, following stopped",
and the lowercase clock words ("paused", "running", "ended") take a capital.

## Controls

Labels as the player routes them (#69): "Pause", "Resume", "Start", "Back 5 s", "Forward 5 s",
"Next song" (sent to the music app), "Next interval", "Previous interval", and, when the press
hands the clock over, "Next interval (stops following)" and "Previous interval (stops following)";
"Follow the music", "Manual clock", "Undo".

The longest, "Previous interval (stops following)" (35 characters), takes a full row of the
controls at 17 px bold in the 1280×800 mock-up and fits on one line. measure.js checks that no
control wraps (C4). The presenter is read at arm's length, so the room-distance heights (C1)
do not apply to it. A control row never shortens a label to make it fit: the row widens, or the
label takes a full row.
