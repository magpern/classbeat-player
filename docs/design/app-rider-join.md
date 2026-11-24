# Screen spec: joining a class in the app

Status: proposed in the pull request for issue #628, for [ADR 0011](../adr/0011-the-phone-app-is-built-with-capacitor.md)
section 1 (rider mode) and [ADR 0007](../adr/0007-riders-in-a-live-session.md). Overview, sizes and
checks: [app.md](app.md). Everything after the join is the rider page of [rider.md](rider.md),
unchanged. Mock-ups: `mockups/app-rider-start.html` (step 1), `app-join-details.html`,
`app-join-code-error.html`, `app-join-error.html`, `app-leave-ask.html`, and their shots.

## Purpose

Let a rider join with the class code from the room screen and a nickname, with nothing else to
give. Nobody opens the app from the QR code's address, so the app adds one step before the rider
page's join form: the class code.

## Content, in priority order

**Step 1, the code** (rider mode's start page, app-modes.md):

1. Mode tag "Rider mode", title "Join a class", hint "Type the class code from the room screen."
2. The **Class code** field, `XXXX-XXXX`, with the focus and the keyboard up (capital letters; the
   hyphen is put in by the field).
3. "Continue" (main). It checks the code's shape only (8 letters); nothing is sent yet.
4. The mode strip (app-modes.md).

**Step 2, the rider** (the rider page's join form, rider.md "Getting in"):

1. Mode tag, title "Join the class", the code on a line ("Class code KXPD-RMTB"), and the privacy
   line: "Your instructor sees your nickname. FTP and max heart rate stay on this phone and are
   never sent."
2. Nickname (focus), FTP and max heart rate (optional), Remember on this phone.
3. "Back" and "Join the class" (main). Back returns to step 1 with the code kept.

The join itself goes through native code (ADR 0011 section 1); the page sends only the code and
the nickname. After the join, rider.md's states hold, with no mode strip.

## Layout

| Size | Layout |
|---|---|
| Phone portrait | One column; the keys after the fields; a form may scroll down while the keyboard is up |
| Phone landscape | Two columns, the words at the left, the fields and keys at the right (rider.md) |
| Tablet | As the phone in the same orientation |

## States

| State | Mock-up | What shows |
|---|---|---|
| Step 1 | `app-rider-start` | As above |
| Code of the wrong shape | `app-join-code-error` | The field keeps what was typed, a thick white border, and "Codes are 8 letters." under it. Nothing was sent |
| Step 2 | `app-join-details` | As above |
| No nickname | `app-join-error` | The nickname field's error "Type a nickname, 1 to 24 characters." Nothing was sent |
| Unknown or ended class, class full | rider.md's notices | The server's answer after Join, in rider.md's words, on step 2 |
| Joined | rider.md | The rider page's class view |
| Leave the class? | `app-leave-ask` | Back while joined: "Leave the class?", "To join again, type the class code again.", keys "Leave" and "Keep riding" (main, has the focus). Leaving closes the rider socket, drops the rider token and returns to step 1 |

## What "Remember on this phone" keeps

The nickname is **never remembered**: the rider types it again each class, and step 2 always
opens with the nickname empty and in focus (ADR 0007 section 1, rider.md). With "Remember on this
phone" on, only the FTP and the maximum heart rate are kept, on the phone only, so those two
fields come up filled. They never leave the device: the join still sends only the code and the
nickname.

They are **cleared** (the fields come up empty and the switch is Off) when:

- the rider leaves the class (the "Leave" key of "Leave the class?");
- the app changes mode, in either direction (switching ends the rider's session, app-modes.md);
- the class ends;
- the rider is dropped from the session (removed by the instructor, or the token dropped).

Each of the four endings returns to step 1, so the next rider on a shared phone sees nothing of
the last one. No mock-up pre-fills the nickname; the join mock-ups show the nickname empty and
Remember Off. Settled in issue #633; ADR 0007 and rider.md win.

## Motion and reduced motion

app.md; rider.md for the class view.

## Wording

rider.md's words throughout. "Class code" for the code, "nickname" for the name.

## Rules (plan section 3)

| Rule | How these screens keep it |
|---|---|
| 7. Colour means the planned zone | No hue before the join; after it, rider.md's |
| 12. No camera | The code is typed; nothing asks for the camera |
| 13. Rider data one way | The join sends the code and the nickname only; FTP and heart rate stay on the phone; the page never shows another rider |
| 14. Join code is a session id only | The code is used to join and nothing else; the rider token lives in native memory for the session and is dropped on leave |
| 15. No team games | None |

## Open questions

- Opening the app from the QR code (app.md): default no, so step 1 stays.
