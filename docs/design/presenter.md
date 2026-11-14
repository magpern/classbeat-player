# Presenter window: wording

Status: proposed in the pull request for issue #78. The presenter window's full spec comes with
PL5. Until then, this file sets one convention for its words, because the player already shows
them (design notes on #65 and #69). Mock-up: [mockups/presenter.html](mockups/presenter.html)
([1280×800](mockups/presenter-1280x800.png), and [1000×720](mockups/presenter-1000x720.png), the
smallest content area the window allows; the player opens with a 1000×760 content area, #126).

**Optional: for a second display only** (plan section 3, "One screen first", owner 2026-11-13).
A class runs on one screen from the room screen's own controls ([room-2d.md](room-2d.md),
"Controls on the room screen"); the presenter window is never needed to run one. With a second
display it keeps everything below. With one display the room screen fills the display and this
window lies behind it (class-list.md, "Where the room window goes").

**Riders** (ADR 0007): the riders row at the foot of the right column and its drawer (count, nicknames,
Remove, Lock joining, New code) are specified in [riders-panel.md](riders-panel.md).

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
| Locked | Following Spotify: "Following" and the music app's name | Same, in grey with a round dot |
| Before the first lock | Waiting for the first song | Same |
| Paused | Music paused | Plate |
| Coasting | Music not heard | Plate |
| Off the list | Not a class song | Plate |
| Ambiguous | Song is in twice | Plate, with "Which one is playing?" and the choices on the presenter |
| Manual | Manual clock | Same, grey with a square marker |
| Manual, before the start | Press Start | Same; the Start it names is the room screen's own Start (shown before the start with one display), Space, or this window's Start |

The presenter's lines carry no marker. The round dot (following) and the square marker (manual)
belong to the room screen, where they tell the link states apart from across the room; on the
presenter the words say it.

Lines in the player today that are worded differently and change to the convention when the
presenter is built:

- "manual clock: following stopped" becomes "Manual clock, following stopped";
- "ended (holding at the end)" becomes "Ended, holding at the end";
- the lowercase clock words ("paused", "running", "ended") take a capital;
- the details now in brackets after the link line ("the clock is guessing", "following the music
  is unavailable on this computer") move to the grey second line.

## Phone remote: the two places

The phone remote panel lists the two phones' places, one line each, "Phone 1: ..." and
"Phone 2: ...", with **Drop** beside a place that holds a phone (ADR 0005 section 3). The words
come from `panel-view.ts`; a place shows one of four lines:

| Line | When | Drop | Non-colour cue |
|---|---|---|---|
| Phone 1: steering | A phone holds the place and is connected | shown | a filled square before the line, the line in full-strength text |
| Phone 1: not connected | A phone holds the place but its connection is away (it may come back; the place is still held) | shown | a hollow square (a 2 px outline, nothing inside) before the line, the line in full-strength text |
| Phone 1: dropping | Drop was pressed and the server has not answered yet | hidden (a second press is not offered) | the hollow square, the line in grey |
| Phone 1: free | No phone holds the place (also once the server has freed a dropped place) | hidden | no square, the line in grey |

- **Text heights.** The presenter is read at arm's length, so its type is set in pixels (the
  convention above), not as a share of the screen. Every place line is **17 px**, the same size as
  the control labels, in Atkinson 700; the place number and the state word are on one line (no
  wrapping at 1000 px wide: the longest line is "Phone 2: not connected", 22 characters). Drop is
  at least 44 px high, as Remove is in [riders-panel.md](riders-panel.md).
- **Telling "not connected" apart from "free" without colour.** The words differ, and so does the
  mark: "not connected" has the hollow square and a Drop; "free" has no mark and no Drop. Grey
  alone never carries the difference. No hue is used (plan section 3, rule 7).
- "Dropping" is shown only while the place's last drop waits for the server (`drop-policy.ts`); it
  is the wait between the press and "free", so the instructor sees that the press took.

The code today is unstyled markup; the squares, greys and sizes above are what PL5 draws. The
words, the Drop rules and the four states are what the code already does.

## PL5 note: the riders list scrolls inside the drawer

The riders list (riders-panel.md) scrolls inside the riders drawer; the head, the actions and the
note never scroll, and the window never grows. Without this, 60 riders (ADR 0002's cap) push the
status line and the transport controls about 1500 px down the window, out of reach while a class
runs. PL5's layout keeps the drawer a fixed share of the window and gives the list the rest.

## Controls

**The room screen has five of them; the rest are here.** The room screen's control band carries
only Start, Pause and Resume, Previous, Next and End (the owner's five), with the same routing
and the same "stops following" wording as a second line (room-2d.md). Back 5 s, Forward 5 s,
"Follow the music", "Manual clock", "Undo" and picking an occurrence of a repeated song stay on
this window and, where they have one, on a key (room-2d.md, "Keyboard": Shift+arrows for the
5 s steps, Ctrl+Z / Cmd+Z for Undo). The keys of that table work in this window too when it has
the focus.

Labels as the player routes them (#69): "Pause", "Resume", "Start", "Back 5 s", "Forward 5 s",
"Next song" (sent to the music app), "Next interval", "Previous interval", and, when the press
hands the clock over, "Next interval (stops following)" and "Previous interval (stops following)";
"Follow the music", "Manual clock", "Undo".

The longest, "Previous interval (stops following)" (35 characters), takes a full row of the
controls at 17 px bold and fits on one line at both sizes of the mock-up, including the
smallest window, where the room preview shrinks to 560 px and the type stays the same.
measure.js checks that no control wraps (C4). The presenter is read at arm's length, so the
room-distance heights (C1) do not apply to it; the type is set in pixels, so a label that fits
in the smallest window fits in any larger one. **Minimum size: 1000×720** (content area, the
smaller of the two mock-up sizes): the window does not shrink below it, so no control row wraps and
the room preview never drops below 560 px. PL5's full spec may set another minimum with its own
mock-up and checks. A control row never shortens a label to make it fit: the row
widens, or the label takes a full row.
