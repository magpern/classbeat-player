# Screen spec: pairing the app

Status: proposed in the pull request for issue #628, for [ADR 0011](../adr/0011-the-phone-app-is-built-with-capacitor.md)
section 5 and [ADR 0002](../adr/0002-accounts-sign-in-pairing-and-tokens.md) (pairing). Overview, sizes and checks:
[app.md](app.md). Mock-ups: `mockups/app-pair-*.html` and their `-390x844.png` and `-844x390.png`
shots.

## Purpose

Pair the phone with the instructor's account the way the desktop does: the app shows a code, the
instructor confirms it on the website while signed in, in the **system browser or a Custom Tab**,
never in the app's web view. The screens make the code easy to copy, make it plain that the
confirming happens on the website, and say what each ending means. Every pairing screen is native.

## Content, in priority order

1. The mode tag "Instructor mode" (app-modes.md allows only "Rider mode" and "Instructor mode"; pairing is the way into instructor mode, so every pairing page carries it) and the title "Pair this phone".
2. The **code**, `XXXX-XXXX` in the number face at the value tier with wide letter spacing, on a
   raised panel labelled "Code". It is the largest thing on the page.
3. How long it lasts: "The code runs out in 9:41", counting down once a second (ten minutes from
   the server's answer).
4. Three numbered steps: open the pair page (the address in full, `https://<server>/pair`), sign in
   and type the code, confirm only if this phone shows the same code.
5. The keys: "Cancel" and "Open the site" (main). "Open the site" opens the pair page in a Custom
   Tab, or the default browser if there is none. The code can also be typed on any other device.

The app asks the server every 5 s whether the code was confirmed (ADR 0002); nothing on the screen
shows the asking except, after a return from the browser, the waiting line.

## Layout

| Size | Layout |
|---|---|
| Phone portrait | One column: mode tag, title, code panel, time left, (note), steps, keys at the end |
| Phone landscape | Left: mode tag, title, code panel, time left, (working line, note). Right: the steps and the keys |
| Tablet | As the phone in the same orientation |

The code never wraps and never shrinks below the value floor; at 360 px wide it fills the panel.

## States

| State | Mock-up | What shows |
|---|---|---|
| Asking for a code | `app-pair-asking` | Working marker "Asking the server for a code"; "Cancel" alone |
| The code | `app-pair-code` | As above, 9:41 left |
| The code, no screen lock | `app-pair-code-no-lock` | The same with a grey note: "This phone has no screen lock. Instructor mode will need one: set it before or after pairing." Pairing goes on |
| Back from the browser, not yet confirmed | `app-pair-waiting` | The working line "Not yet confirmed on the website" above the code; the main key becomes "Open the page again" |
| Paired | `app-pair-done` | "This phone is paired", the status line "Paired as <account e-mail>", "Confirm your screen lock to open instructor mode.", and "Continue", which opens the screen-lock prompt (or app-modes.md's no-lock screen) |
| Refused | `app-pair-denied` | A white plate "Refused on the website. / Nothing was kept on this phone." Keys "Rider mode" and "Start again" (main) |
| Code ran out | `app-pair-code-expired` | Plate "The code ran out. / It was not confirmed in time. Start again for a new code." Same keys |
| Server unreachable | `app-pair-unreachable` | Plate "The server could not be reached. / Check the connection, then start again." Same keys |
| No Keystore | `app-pair-no-keystore` | Plate "This phone cannot be paired. / It has no Android Keystore, so there is no safe place for the pairing. Rider mode works without it." One key, "Back to rider mode". There is no plain-text fallback (ADR 0011 section 5) |
| Too many pairings | `app-pair-too-many` | Plate "Too many pairings were started. / Try again in an hour." (the desktop's `too_many`, from this network). Same keys as Refused; "Start again" asks again, and the server may still refuse until the hour has passed |
| Answer not understood | `app-pair-unexpected` | Plate "The answer was not understood. / The app could not read the server's answer. Try again later." (the desktop's `unexpected`). Same keys as Refused. Nothing was kept |
| Pairing could not be kept | `app-pair-save-failed` | Plate "The pairing could not be kept. / The Android Keystore did not keep it, so the pairing was undone. Start again." (the desktop's `save_failed`; the app asks the server to drop the record it made). Same keys as Refused |
| Unpaired on the website | `app-pair-revoked` | Shown at the next start in instructor mode, or at once if the app is open, after a 401 that means the device was removed: plate "Unpaired on the website. / The classes saved on this phone were removed." Same keys as Refused |

The three new plates use the same mode tag, title, plate and keys as Refused, so each has one mock-up and the same two sizes. "Cancel" and "Rider mode" go back to rider mode's start page; the code is dropped. Back is
"Cancel". A pairing screen never shows the device token, any part of it or the account's
password.

## Motion and reduced motion

app.md. The countdown changes once a second as text; nothing else moves. With "Remove animations"
the pages swap at once.

## Wording

- "the website" for the site, "the code" for the pairing code, "confirm" for the approval.
- The notices are the player's pairing notices (`core/pairing/view.ts`) in the app's words; the
  heading says what happened, the line under it what to do.

## Rules (plan section 3)

| Rule | How these screens keep it |
|---|---|
| 7. Colour means the planned zone | No hue on any pairing screen |
| 12. No camera | The code is shown and typed; no QR code is shown or scanned |
| 13, 14, 15 | Pairing is instructor mode's; no rider data, join code or team on these screens |

## Open questions

None beyond app.md's.
