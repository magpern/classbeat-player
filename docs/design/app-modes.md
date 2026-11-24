# Screen spec: the app's two modes and the switch between them

Status: proposed in the pull request for issue #628, for [ADR 0011](../adr/0011-the-phone-app-is-built-with-capacitor.md)
section 1 (one app, two modes). Overview, sizes and checks: [app.md](app.md). Mock-ups:
`mockups/app-rider-start*.html`, `app-lock-cancelled.html`, `app-no-lock.html`, `app-instructor-start.html`,
`app-to-rider-ask.html`, `app-switching.html`, `app-switching-instructor.html`, and their `-390x844.png` and `-844x390.png` shots.

## Purpose

Tell the user at a glance which mode the app is in, give each mode one clear way to the other,
and make the way into instructor mode pass the phone's screen lock every time. A rider who hands
their phone to nobody never sees anything about instructors beyond one line and one key.

## Content, in priority order

On each mode's **start page** (rider mode: step 1 of the join, app-rider-join.md; instructor mode:
the class list):

1. The **mode tag**: "Rider mode" or "Instructor mode", a grey label with a filled dot, first on
   the page. It is on every page outside a class, so the two modes, which look alike on purpose,
   are never confused.
2. The page's own content (the join's class code; the class list with its status line).
3. The **mode strip**, last: a line across, a grey lead line, and one full-width key that names
   the mode it goes to. Rider mode: "Switch to instructor mode", with "Teaching? Switch to pair
   this phone with your account." on an unpaired phone, or "Teaching? Your screen lock opens
   instructor mode." on a paired one. Instructor mode: "Switch to rider mode", no lead line.

The strip is never shown with a class open, while a rider is joined, on a pairing page or in a
question (A9). There is no mode switch anywhere else: not in a menu, not in a notification, not
in the class.

## Layout

| Size | Layout |
|---|---|
| Phone portrait (390 × 844; 360 × 640) | One column: mode tag, title, hint, content, keys; the strip at the end. On a form the strip may sit below the keyboard and is reached by scrolling, as the field has the focus |
| Phone landscape (844 × 390; 640 × 360) | Two columns: mode tag, title and hint at the left; the content, the keys and the strip at the right |
| Tablet (768 × 1024; 1024 × 768) | As the phone in the same orientation, at the sizes of app.md ("Sizes") |

A question (the switch to rider mode) and the no-lock screen keep the same two layouts; their keys
are the last thing in the right column (landscape) or at the end (portrait). Two keys whose words
are long are stacked, the main one first.

## States

| State | Mock-up | What shows |
|---|---|---|
| First launch, unpaired | `app-rider-start` | Rider mode, step 1 of the join; strip "Switch to instructor mode" with the pairing lead line. The key starts pairing (app-pairing.md) |
| Rider mode, paired | `app-rider-start-paired` | The same, with the screen-lock lead line. The key opens the system screen-lock prompt, at once, with no screen of ours before it |
| Screen lock cancelled, failed or locked out | `app-lock-cancelled` | Back on the rider start page, a white plate "Still in rider mode / Instructor mode opens only after your screen lock." Nothing changed. Android's own prompt already says when the screen lock is locked for now, and returns the same answer as a cancel, so a lockout shows this plate too (there is no separate "Too many tries" plate). The plate goes when the user types or presses anything |
| No screen lock on a paired phone | `app-no-lock` | Native screen. Title "A screen lock is needed", why, and a note that the classes and the pairing stay locked away on the phone. Keys "Set a screen lock" (opens Android's security settings) and "Stay in rider mode". Coming back with a lock set opens the screen-lock prompt; coming back without one shows this screen again |
| Instructor mode | `app-instructor-start` | Mode tag, "Classes", the status line ("Up to date", or class-list.md's other sync states), one key per class (title, then length and song count), the strip "Switch to rider mode" |
| Switch to rider mode? | `app-to-rider-ask` | Native question. "The class list closes and the music is no longer followed. Coming back to instructor mode needs your screen lock." Keys "Stay" (main, has the focus) and "Switch". Back, or leaving the app, is "Stay" |
| Switching | `app-switching`, `app-switching-instructor` | Native, under a second: mode tag "Rider mode", "Switching to rider mode", the working marker with "Closing instructor mode". Native code stops the follower, closes every connection, drops the instructor state and reloads the page fresh; only then the rider start page shows (ADR 0011 section 1). To instructor mode, after the screen lock passed: mode tag "Instructor mode", "Switching to instructor mode", the working marker with "Closing rider mode"; native code drops the rider's numbers and the web view's storage, then loads the class list fresh. The same layout, rules and timing |

Where the app starts: in the last mode used; on a first launch, in rider mode. A restart in rider
mode never skips the screen lock. Instructor mode with a class open stays on the class; Back on the
class screen goes to the class list, never to rider mode.

No question guards the way **into** instructor mode: the screen-lock prompt is that question.

## Motion and reduced motion

app.md: at most 300 ms, a fade; none with "Remove animations". The switching screen does not
animate; it is replaced as soon as the rider page has loaded.

## Wording

- The modes are "rider mode" and "instructor mode", always in these words, lower case inside a
  sentence.
- The screen lock is "your screen lock" (Android's own term), never "PIN" alone or "password".
- Keys say what happens: "Switch to instructor mode", "Switch", "Stay", "Set a screen lock",
  "Stay in rider mode".

## Rules (plan section 3)

| Rule | How these screens keep it |
|---|---|
| 7. Colour means the planned zone | No hue: the mode tag, strip, plates and keys are white, grey and black |
| 12. No camera | Nothing asks for the camera |
| 13. Rider data one way | Rider mode is entered only after native code has dropped every instructor connection and state; the rider page never shows another rider |
| 14. Join code is a session id only | The class code is the only thing the rider page asks for besides the nickname |
| 15. No team games | None |

## Open questions

None beyond app.md's.
