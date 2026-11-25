# Screen spec: Connect Swedebeat, the mix and the fall-back reasons

Status: proposed in the pull request for issue #688, for [ADR 0013](../adr/0013-swedebeat-playback.md)
(sections 1, 3, 4 and 7, issue 1). Design system: [system.md](system.md). It extends
[class-list.md](class-list.md) (the page) and [room-2d.md](room-2d.md) (the room screen's link line).
Reference mock-ups and screenshots: [mockups/](mockups/), files `class-list-swedebeat-*` and
`room-mix-*`, written by `mockups/swedebeat-pages.js`.

Everything here is built and tested on the fake source. The sign-in fields are **provisional**:
they are whatever the active source's `credentialFields()` returns (the fake: a username and a
password), and are revisited when the real source is chosen (ADR 0013, issues 4 and 7).

## Purpose

Three things, in the words of someone who teaches a class and is not looking at a settings screen:

1. **Connect Swedebeat once** on the class list page, and sign out of it.
2. **See, on the class and in the room, whether the mix is ready**: not yet, on its way (with a
   number), ready, or could not be used.
3. **Know why a Swedebeat class is on the manual clock** whenever it is, in a few plain words, before
   the start and again if it happens during the class.

The screens never ask for a password anywhere but the one form, never show one, and never name
another company's app (rule 3's wording stays: the music is the provider's, played by the player
only when the provider allows it).

## Where it sits

- **The class list page only** (ADR 0013 section 1). Never the room window, the presenter window or
  the scene. The page offers no field at all while playback is off.
- **The Swedebeat line** is one line under the sync status, in the same form (marker, one line of
  words, a grey detail line, at most one button). It is shown only when the list holds a class
  whose `music.source` is `swedebeat`, or when a Swedebeat token is held (so it can be signed out).
  A list of Spotify and manual-clock classes is exactly as class-list.md draws it.
- **The mix on a class card** (a row): added to the row's second line, after the source and the
  song count, on Swedebeat rows only, and only while a source is on.
- **In the room**: the room screen's link line (the rail's top right), the place where it already
  says "Following Spotify" or "Press Start". Nothing else on the room screen changes.
- The presenter window already shows the link line's words; it shows the same words, no new part.

## Content, in priority order

Class list page, Swedebeat line:

1. The state in words, with its marker: "Swedebeat is connected", "Swedebeat is not connected",
   "Swedebeat playback is off", "Connecting to Swedebeat…".
2. What it means for the classes, in the grey detail line ("Swedebeat classes play on the manual
   clock.").
3. The one key that fits: "Connect Swedebeat", "Sign out of Swedebeat", "Connect Swedebeat again",
   "Try again". None while off.

A row (a class card), after "Swedebeat, 12 songs": the mix marker and its words. In the footer, the
line under the selected class's title says what Start will do, including the reason when it will be
the manual clock.

Room: one link line, with a marker and words, at the label tier.

## Layout

### The Swedebeat line

```
(o) Up to date                                                         (sync status)
    Paired as ana@example.com, "Studio PC"
(sq) Swedebeat is not connected                         [ Connect Swedebeat ]
     Swedebeat classes play on the manual clock. Connect to play the mixes.
[ Find a class ]                                                       (8+ classes)
```

44 px high, 6 px under the sync status, the same 20 px type scale as the status (18 px bold for the
state, 16 px grey for the detail). A **white plate with black text** replaces the line when it needs
the instructor (a refusal, "connect again", "Sign out of Swedebeat?"), the system's only alert form.

### The form

Takes the body in place of the list, as pairing does: the heading "Connect Swedebeat" (Big Shoulders
800, 40 px), one sentence, one field per entry of `credentialFields()` in the order the source gives
(a 14 px grey label over a 44 px field, at most 440 px wide), "Connect" (main, Enter) and "Cancel"
(Esc), and a grey line under them. The first field has the focus. While it is shown the Swedebeat
line is not (the panel says it).

Field rules (the only place a credential is typed):
- A field the source marks secret shows dots as typed and has **no "show" key**. Nothing the page
  holds is ever painted as the password's text, in a field, a message or a log line.
- `autocomplete="off"`; the field is not offered to a password manager; input over 256 characters
  is refused in the field (the main process refuses it too).
- On submit the page **clears every field at once**, success or failure, before anything else. A
  failure shows empty fields. Nothing is kept in the page, its storage or the history.

### A row

```
Monday morning endurance                                        45:00   9 Nov
Swedebeat, 12 songs   (o) Downloading the mix 63%  [=====-----]
```

| Element | Face | Meaning |
|---|---|---|
| Marker | 11 px, white, no hue | Filled circle: ready. Hollow circle: working (downloading, or waiting its turn). Hollow square: plays on the manual clock |
| Words | Atkinson 400, 16 px | "Mix ready", "Downloading the mix 63%", "Mix waiting to download", "The mix could not be checked", "Manual clock" |
| Bar | 96 × 8 px, white on black with a 1 px grey outline | Only while downloading. The number is in the words; the bar never carries it alone |

The number steps in whole per cents, at most once a second. Nothing else on the row changes size.
While playback is off the row has no mix marker at all (the Swedebeat line says why, once).

### The room link line

At the room's rail (label tier, room-2d.md): a dot or square, then words. No plate: none of these is
a fault the room must act on. A fall-back that happens during the class shows a short form of the reason, white, for 30 seconds (news, as
"Following stopped"), then grey "Manual clock" as room-2d.md has it.

| Size | Layout |
|---|---|
| Class list, 1920×1080, 1280×800, 1000×720 | As drawn; the column is 1280 px at most, centred. At 1000×720 with a plate and 12 classes: 5 full rows |
| Room, every size of room-2d.md | The link line is as long as its words; "Mix still downloading" is the longest in a class and fits at 1024×768 and 1280×1024 (the narrow layout drops the segment name) |

## States

### Class list page

Body order of class-list.md is unchanged; this adds the Swedebeat line to body (4), paired, and its
own panels.

| State | Data (`MixView`) | Swedebeat line | Body | Mock-up |
|---|---|---|---|---|
| Playback is off | `off` (code: `disabled`) | Hollow square, "Swedebeat playback is off", detail "Swedebeat classes play on the manual clock." **No button, no field** | List as before. Footer detail for a Swedebeat class ends "Manual clock: Swedebeat playback is off" | [off](mockups/class-list-swedebeat-off.html) |
| Not connected | `signed_out` | Hollow square, "Swedebeat is not connected", detail "Swedebeat classes play on the manual clock. Connect to play the mixes.", key "Connect Swedebeat" | Each Swedebeat row: hollow square "Manual clock". Footer detail ends "Manual clock: Swedebeat is not connected" | [not connected](mockups/class-list-swedebeat-signed-out.html) |
| The form | `signed_out`, form open | Not shown | Panel "Connect Swedebeat": the sentence "Type the details you use for Swedebeat. They are used once to connect and are not kept.", the fields, "Connect", "Cancel", and "Your password is not kept." | [form](mockups/class-list-swedebeat-form.html) |
| Field left empty (`sw-form-missing`) | `signed_out`, form open, Connect pressed with a field empty | **Plate** "Type your <empty fields>", detail "Every field is needed to connect. Nothing was sent." The fields are named in lowercase, in the form's order: "a", "a and b", "a, b and c" (fake source: "Type your password", "Type your username", "Type your username and password") | The form, fields already filled kept as typed; nothing was read or sent | [missing](mockups/class-list-swedebeat-form-missing.html) |
| Not taken | the shell gave no answer to the details | **Plate** "Those details were not sent", detail "Type them again. Nothing was kept." | The form, empty | [not sent](mockups/class-list-swedebeat-form-not-sent.html) |
| Did not finish | the call to the shell failed | **Plate** "Connecting did not finish", detail "Type your details again to try once more." The page reads the shell's state again | The form, empty | [did not finish](mockups/class-list-swedebeat-form-unfinished.html) |
| Connecting | `signing_in` | Hollow circle, "Connecting to Swedebeat…", detail "Your details were sent and have been cleared from this page" | Panel "One moment": "Swedebeat classes can start on the manual clock meanwhile." No fields, no key | [connecting](mockups/class-list-swedebeat-connecting.html) |
| Details refused | `refused` (`bad_credentials`) | **Plate** "Swedebeat did not accept those details", detail "Check them and type them again. Nothing was kept." | The form again, fields empty | [refused](mockups/class-list-swedebeat-refused.html) |
| Too many tries | `refused` (`rate_limited`) | **Plate** "Too many tries", detail "Wait a few minutes, then type your details again. Nothing was kept." No number of minutes | The form again, empty | [too many](mockups/class-list-swedebeat-rate-limited.html) |
| Could not be reached | `refused` (`unavailable`) | **Plate** "Swedebeat could not be reached", detail "Check the connection, then try again. Swedebeat classes play on the manual clock.", key "Try again" (opens the form) | List; rows "Manual clock" | [unreachable](mockups/class-list-swedebeat-unreachable.html) |
| Connected | `signed_in` | Filled circle, "Swedebeat is connected", detail "Mixes download in the background and play from this computer", key "Sign out of Swedebeat" | List; each Swedebeat row shows its mix (below). Footer detail "Starting plays the mix and opens the room screen and the presenter window" when the selected mix is ready, otherwise the reason (Fall-back reasons); while the mix downloads and has not been caught up, "Starting plays the mix while it downloads" | [connected](mockups/class-list-swedebeat-signed-in.html) |
| Connect again | `signed_out` after an invalid token (the token only was deleted) | **Plate** "Swedebeat needs you to connect again", detail "The mixes saved on this computer are kept. Swedebeat classes play on the manual clock.", key "Connect Swedebeat again" (opens the form) | List; rows "Manual clock" | [connect again](mockups/class-list-swedebeat-reconnect.html) |
| No safe place | `keychainUsable` false | Hollow square, "Swedebeat cannot be connected here", detail "This computer has no safe place to keep the sign-in. Swedebeat classes play on the manual clock." No key | List; rows "Manual clock" | [no keychain](mockups/class-list-swedebeat-no-keychain.html) |
| Sign out, asked | `signed_in`, key pressed | **Plate** "Sign out of Swedebeat?", detail "The mixes saved on this computer are removed. Swedebeat classes play on the manual clock.", keys "Sign out" and "Keep connected" (Esc; has the focus) | List as it was | [sign out asked](mockups/class-list-swedebeat-sign-out-ask.html) |
| Signing out | the deletion of ADR 0013 section 1 is running | Hollow circle, "Signing out of Swedebeat", detail "The mixes saved on this computer are being removed" | Panel "One moment": "Nothing can start until this is done. You can still open a class file." No list, no Start (as "Cache being wiped") | [signing out](mockups/class-list-swedebeat-signing-out.html) |

Notes:
- The sync states of class-list.md still lead: with the cache unreadable, being wiped or pairing in
  progress the Swedebeat line is not shown.
- "Try again" and "Connect Swedebeat again" open the form; they never send anything themselves.
- **The class filter stays under the Swedebeat plates.** Under the two fault plates ("Swedebeat could
  not be reached", "Swedebeat needs you to connect again") and under the sign-out question the
  filter (from eight classes, class-list.md) and the list stay shown; only the form, a file's error
  plate or a sync panel takes them away (`allowed` in `core/list/screen.ts`; the plate is
  `.plate.mix` with 10 px padding in `renderer/classlist.css`, so the five rows still fit).
- The three plates above the form (field left empty, not taken, did not finish) are the page's own
  notes. They replace a refusal the shell still holds while the form is open, and none of them shows
  a value typed in a field. The empty-field plate has no key: the form's own "Connect" and "Cancel"
  stay. **Long field lists (W6):** the plate takes at most three lines in all. The headline is one
  line or two and the detail one line; a source whose empty fields do not fit in two headline lines
  must have its labels shortened in `credentialFields()`, the plate is never ellipsised or cut.
- Sign-out never asks for the password and works with no network (the deletion is local).

### A row's mix (while a source is on)

| Mix | Words | Marker | Notes |
|---|---|---|---|
| Not wanted yet / no token | "Manual clock" | Hollow square, grey | The reason is on the Swedebeat line and in the footer |
| Waiting its turn | "Mix waiting to download" | Hollow circle | Downloads are one at a time per account (ADR 0013 section 3) |
| Downloading | "Downloading the mix 63%" and the bar | Hollow circle | Whole per cents |
| Ready | "Mix ready" | Filled circle, white | Checked: length and, where given, the SHA-256 |
| Could not be checked | "The mix could not be checked" | Hollow square, grey | The file was deleted; this class plays on the manual clock. No promise of a retry is made |

### Room screen

| State | Link line | Mock-up |
|---|---|---|
| Before the start, mix ready | White dot, white: "Mix ready" | [ready](mockups/room-mix-ready.html) |
| Before the start, mix downloading | Hollow circle, grey: "Downloading the mix 63%". Start works: the mix plays while it downloads | [downloading](mockups/room-mix-downloading.html) |
| Before the start, manual clock | Grey square: "Press Start · *reason*" | [fall-back](mockups/room-mix-fallback.html) |
| Before the start, longest reason | Grey square: "Press Start · Swedebeat cannot be connected here"; checked at 1920×1080, 1280×1024 and 1024×768 | [longest](mockups/room-mix-fallback-longest.html) |
| Running on the mix | White dot, white: "Playing the mix". No bar count and no "Music not heard": the clock is the audio | [playing](mockups/room-mix-playing.html) |
| Fell back during the class | White square for 30 s with the short reason ("Mix still downloading"), then grey "Manual clock". The clock continues from where it was; the audio has stopped | [fell back](mockups/room-mix-fell-back.html) |

Pause, Resume, seek and stop on the room's own controls act on the audio and the class together
(ADR 0013 section 4); their look is room-2d.md's, unchanged.

## Fall-back reasons

One fixed list, one sentence each, sentence case, no full stop on a line. The first four are the
words of ADR 0013 section 4; the last two are added here for two branches of the same policy that
the ADR leaves unworded.

| Reason | Words | When (`mode-policy.ts`) | Where it shows |
|---|---|---|---|
| `off` (code: `disabled`) | Swedebeat playback is off | The source is `UnavailableMixSource` | Swedebeat line, footer, room link |
| `not_connected` | Swedebeat is not connected | No token (never connected, signed out, or the token went invalid) | Same |
| `downloading` | The mix is still downloading | A chunk the sound needs is not yet written and 10 s passed: during the class, or when the sound would catch up with the download | Footer, room link (during the class) |
| `not_checked` | The mix could not be checked | A chunk or the length failed its check, or the decoded length is more than 1 000 ms from `length_ms`, or the source would not describe it | Row, footer, room link |
| `no_keychain` | Swedebeat cannot be connected here | `keychainUsable` is false | Swedebeat line, footer, room link |
| `not_allowed` | This account cannot play this mix | `describe` says the account may not play it | Footer, room link |

The words are the same on the class list and in the room, so what the instructor read before the
class is what the room says. The room adds "Press Start · " before the start; during the class it shows a short form of the reason alone for 30 s (the square says manual): "Mix still downloading", "Mix not checked" and "Signed out of Swedebeat" (`not_connected`, when the account signs out of Swedebeat mid-class). Only these three can happen during a class (`disabled`, `no_keychain` and `not_allowed` are decided at the start). A reason never names an error code, a host, a path, the token or the source's
origin (ADR 0013 section 1).

## Keyboard

class-list.md's order of Tab, with the Swedebeat key after "Open a class file" and the sync key.
In the form: Tab goes field to field to "Connect" to "Cancel"; Enter in a field submits; Esc cancels
and clears the fields. "Keep connected" is the default of the sign-out question (Esc keeps).
The focus ring is class-list.md's: 3 px `--light-1`.

## Measurable criteria

Checked by `mockups/measure.js` (in the repository; run `ONLY='swedebeat|room-mix' node docs/design/mockups/shoot.js`, which shoots and checks the fixtures of `swedebeat-pages.js`) on every state below at the three window sizes (class list) and the
three room sizes (room); the product's CI screenshots are held to the same numbers.

| # | Check | Number |
|---|---|---|
| W1 | Cap height, class list (window height 720) | As class-list.md L1: Swedebeat line state and plate headline (18 to 20 px type) at least 14 px (1.9 %); detail and mix words (16 px) at least 11 px (1.5 %); buttons at least 12 px (1.7 %); the form's heading at least 28 px (3.9 %); field text (18 px) at least 13 px (1.8 %); labels at least 9.5 px (1.3 %). No text under 14 px |
| W2 | Room: the link line | Label tier of room-2d.md: cap height at least 2.0 % of screen height at every room size; the longest lines, "Press Start · Swedebeat cannot be connected here" before the start and "Mix still downloading" during the class, on one line, inside the safe area, at 1024×768 and wider |
| W3 | Contrast | Class list as L2: 7 : 1 for the state, plate and mix words (the lowest measured on the mock-ups is 7.2 : 1), 4.5 : 1 for labels. Room: 4.5 : 1 for the link line (the lowest measured on the link lines is 7.2 : 1) |
| W4 | What is visible at once | Class list: header, sync status, Swedebeat line, list header, at least **5 full rows** and the footer with Start at 1000×720 and every size above (**5 whole rows is the floor with a Swedebeat plate**, the filter still shown, at 1000×720); the selected row fully visible. The form shows its heading, every field, both keys and the grey line without scrolling at 1000×720. Room: the link line and everything the room already shows |
| W5 | The state is more than a colour | There is no hue on any of these screens (the checker's hue test). Every state is a word and a shape: filled circle, hollow circle, hollow square. A percentage is always a number in words |
| W6 | Nothing is cut | No text is ellipsised or clipped; a plate may take up to three lines |
| W7 | Controls | Every key and field at least 44 px high |
| W8 | Motion | Nothing animates. The bar changes width in steps of a whole per cent at most once a second, with no transition, so the reduced-motion form is the same |
| W9 | Text | All text is live text in the page; the dots in a secret field are the field's own, nothing is a picture |
| W10 | Tokens | Only `tokens.css` colours, faces and sizes |

## Motion

None, as class-list.md. The bar and the percentage are updated in place once a second at most; a
screen reader hears the percentage at every 10 per cent, not every step (`aria-valuenow` changes,
the live region speaks "Downloading the mix 60%"). The room's 30 s white link line changes colour at
once, with or without reduced motion.

## Wording

"Connect", "sign out" and "mix" are the only words used for the account and the audio; "Swedebeat" is
the provider's name as the plan and ADR 0013 use it. No other company's name or app appears, and
nothing says how the sign-in works inside. Plates that carry a sentence keep their full stop; lines
and keys have none.

## Data each element needs

The renderer holds a view built field by field, as `SyncView` and `PairingView` are (class-list.md,
"Data"). Proposed, for issues 4 to 6:

| Element | Source |
|---|---|
| The Swedebeat line | `MixView.state`: `disabled` (this spec's `off`), `signed_out`, `signing_in`, `signed_in`, `refused` (ADR 0013 section 1; `unavailable` is a refusal reason only), plus `refusal` (`bad_credentials`, `rate_limited`, `unavailable`), `needsReconnect`, `keychainUsable`, `signingOut` |
| The fields | `MixView.fields`: `[{id, label, secret}]` from `credentialFields()`. Never a value |
| A row's mix | The row's `mix`: `{state: waiting, downloading, ready, bad, none, percent}`, built from the cache header's state and bytes. Never a mix id, tag or path |
| The footer's reason | `modePolicy` result: `mix` or a reason of the table above |
| The room's link line | The `mix` music link's view: `ready`, `downloading` with percent, `playing`, `manual` with a reason |

## What the screens never show (plan section 3)

| Rule | How these screens keep it |
|---|---|
| 1. A finished class and nothing more | No mix choice, no choice of file, no offset: the class names its mix |
| 2. Never controls equipment | Nothing here refers to a bike or a machine |
| 3. Spotify's music stays in Spotify's app | A mix is shown only on a Swedebeat class; a Spotify row never shows a mix state, a bar or a key. No audio from our server is named or implied |
| 4, 5. No road, terrain or moving viewpoint | No scene change |
| 6. None of MOWL's look | Plain words, markers and a bar on black |
| 7. Colour is the planned zone | No hue (W5) |
| 8, 9 | No hand-position icon, no load figure |
| 10, 11 | No cue and no history: no "last played", no "most used" |
| 12. No camera | None |
| 13, 14, 15 | No rider data, join code or team on these screens |

## Open questions

- ADR 0013 section 4 words "The mix is still downloading" as a reason before the start, while
  section 3 lets a class start while its mix downloads. This spec shows "Downloading the mix 63%"
  before the start and the reason only when the sound would catch up; if issue 6 decides otherwise,
  only the room's second row changes.
