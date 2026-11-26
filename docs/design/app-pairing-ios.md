# Screen spec: pairing the iOS app

Status: proposed in the pull request for issue #924, for [ADR 0016](../adr/0016-the-ios-app.md)
sections 3 and 4 and [ADR 0002](../adr/0002-accounts-sign-in-pairing-and-tokens.md) (pairing).
The pairing logic is built (issue #896); this is the screen it lacks. Overview, sizes and checks:
[app.md](app.md). The Android screens it follows: [app-pairing.md](app-pairing.md).

**This spec is a delta.** Everything in app-pairing.md holds on iOS (purpose, content in priority
order, layout, the state table, motion, wording, rules) except what this file names. Where the two
differ, this file wins for iOS. Not a new direction: no new type, colour, key shape or element.

## What is the same

The mode tag, title, code panel, countdown, three steps, keys, plates and layouts are the Android
ones, drawn natively (UIKit) from the same tokens, fonts and `vh`/`vw` sizes, so the pages are
identical to the Android shots. The Android mock-ups are the reference for these states, unchanged:
`app-pair-asking`, `app-pair-code`, `app-pair-waiting`, `app-pair-denied`, `app-pair-code-expired`,
`app-pair-unreachable`, `app-pair-too-many`, `app-pair-unexpected`, `app-pair-revoked`. The words
"the website", "the code" and "confirm" are the same. Step 1 says "your browser", which on iOS is
Safari; no platform name shows in the steps.

## What differs

| Topic | Android | iOS |
|---|---|---|
| Opening the pair page | Custom Tab or browser | Safari, left through `UIApplication.open` (ADR 0016 section 3); never the app's web view. The app goes to the background |
| Where the token is kept | Android Keystore | Keychain, `WhenPasscodeSetThisDeviceOnly`; with no passcode the Keychain refuses |
| No screen lock while pairing | Pairing goes on, with a grey note (`app-pair-code-no-lock`) | **Cannot happen**: no passcode means no pairing. There is no note state; the case is the plate below |
| After pairing | System screen-lock prompt | System prompt of LocalAuthentication (Face ID, Touch ID or the passcode), not drawn by us |
| System insets | `WindowInsets` | Safe area (notch, Dynamic Island, home indicator) |
| Reduced motion | "Remove animations" | "Reduce Motion" (`isReduceMotionEnabled`) |
| Back | System Back is "Cancel" | The edge swipe is "Cancel" (its effect is the key's) |

## States that differ

| State | Mock-up | What shows |
|---|---|---|
| Paired | `app-pair-ios-done` | Title "This phone is paired", status "Paired as <account e-mail>", line "Confirm it is you to open instructor mode.", key "Continue" (opens the system prompt). The line is the same words whichever of Face ID, Touch ID or the passcode the phone uses. Reached from "Pair again" in instructor mode, the line is absent and "Continue" returns to the class list, as on Android. A long e-mail wraps inside the window and never scrolls sideways |
| No passcode (the desktop's `noKeychain`) | `app-pair-ios-no-passcode` | Plate "This phone cannot be paired. / Pairing needs a passcode to keep it safe. Set one in Settings, then start again. Rider mode works without it." Keys "Rider mode" and "Start again" (main). Unlike Android's one key, "Start again" is offered, because setting a passcode can fix it; it checks again and shows the same plate if there is still none. There is no plain-text fallback (ADR 0016 section 3). No key opens Settings: iOS lets an app open only its own settings page |
| Pairing could not be kept | `app-pair-ios-save-failed` | Plate "The pairing could not be kept. / The Keychain did not keep it, so the pairing was undone. Start again." Same keys as Refused. The app asks the server to drop the record it made |
| Server unreachable, no server address | `app-pair-unreachable` | **Today every iOS build has no server address** (ADR 0016 section 4, until the owner decides). The pairing's `noServer` notice is shown as this plate, as Android's `NO_SERVER` is. "Start again" shows the plate again. The phone never shows `noServer` or `unpaired` words |

On leaving the phone for Safari and coming back:

- While the app is not in front it asks nothing (no background modes, ADR 0016 section 2). On
  return it asks the server at once, then every 5 s. If the code was confirmed, the page goes to
  "This phone is paired" with no waiting line shown.
- Not yet confirmed on return: `app-pair-waiting`, as Android. The code's time left is counted
  from the server's expiry, so a long stay in Safari can come back to "The code ran out".
- Back in the app through the status-bar breadcrumb or the app switcher is the same return.

## Measurable criteria

All of app.md's checks A1 to A14 hold on the iOS screens, with the same numbers; the new pages pass
them at all six sizes of app.md. In short:

| Check | Requirement |
|---|---|
| Text height, portrait / landscape, share of window height | Code and titles **3.4 % / 6 %**; text **2.6 % / 4.5 %**; key words, plates, steps, status lines **1.9 % / 3.4 %**; labels, hints and the mode tag **1.5 % / 2.7 %**. Never under 21, 16.5, 12.5 and 10 px |
| Contrast | At least **7 : 1** for every text against the worst pixel of its ink |
| Touch targets | At least **64 × 64 pt**, at least **12 pt** apart (above Apple's 44 pt) |
| Visible at once | Mode tag, title, plate or code with its time left, and every key, with no scroll, at the sizes below; inside the safe area |
| Zone | No hue on any pairing screen (rule 7) |
| Text | Live text in the bundled fonts; no word in a picture |

Sizes: the reference phone 390 × 844 each way up (the shots kept), 360 × 640 each way up and a
tablet 768 × 1024 each way up (checked). The iPhone SE at 375 × 667 sits between the first two
in both dimensions and is covered by them: the tiers are shares of height, and no page wraps
beyond its slot at either.

## Motion and reduced motion

As app-pairing.md: the countdown changes once a second as text; nothing else moves. Transitions are
the system's cross-fade, at most 300 ms, never a slide from an edge. With Reduce Motion on, pages
swap at once. A screen reader (VoiceOver) reads the mode tag, the title, then the code letter by
letter, then the time left.

## Security of the screens

A pairing screen never shows the device token, any part of it or the account's password, and the
token never reaches the web view (ADR 0016 section 3). These screens are native; the web view
cannot draw or read them. The code on screen is excluded from screenshots the system takes of the
app switcher (the screen is hidden when the app goes to the background).

## Rules (plan section 3)

As app-pairing.md: rule 7 (no hue), rule 12 (the code is shown and typed; no camera, no QR code;
no camera usage key), rules 13 to 15 (pairing is instructor mode's; nothing about a rider).

## Open questions

- The iOS build has no server address until the owner decides on backend calls (docs/owner.md,
  ADR 0016 section 4). Until then every attempt ends on the unreachable plate. Default: as above,
  no separate "not available yet" state, so the screens need no change when the address arrives.
- Hiding the code in the app switcher is a requirement of this spec for the developer to build and
  test in the pairing screen's pull request; it is not yet in the pairing logic.
