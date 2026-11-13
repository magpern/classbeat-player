# Screen spec: the website pages

Status: proposed in the pull request for issue #131. Design system: [system.md](system.md).
Neighbouring specs: [class-list.md](class-list.md) (the same class list, in the computer's own
window) and [presenter.md](presenter.md) (wording convention). Reference mock-ups and screenshots:
[mockups/](mockups/), files `site-*.html` (57 states) and `site-*-<width>.png`.

## Purpose

The pages the instructor uses in a browser (plan section 5, "A small website"): sign in, see the
classes, pair and revoke devices, manage the account. It is read at arm's length on a phone, a
tablet or a laptop, so it follows the class list's convention: sizes in pixels, not shares of the
screen height (the room-distance numbers of room-2d.md do not apply), and the same tokens.

It is a small site and nothing more (rule 1): the classes are shown as they were sent, never
edited, never reordered, no song choice, no rider data, no ranking (rule 13), no legal text (that
is the owner's). The product's name is not set here; the mock-ups carry the placeholder "Class
player" in the header, one string to replace.

## Pages and their addresses

| Page | Address | Who sees it |
|---|---|---|
| Sign in | `/sign-in` (the mailed link is `/sign-in#<token>`) | Anyone |
| Classes, a class | `/classes`, `/classes/{id}` (`/` goes to `/classes`) | Signed in |
| Devices | `/devices` | Signed in |
| Pair a device | `/pair` (ADR 0002, section 6; the app opens it) | Signed in |
| Account: Sessions, Passkeys, Linked apps, Your data | `/account/sessions`, `/account/passkeys`, `/account/links`, `/account/data` (`/account` goes to Sessions) | Signed in |
| Connect an app | `/link/source?...` (ADR 0002, section 7; the source opens it) | Signed in |
| Errors | shown in place of a page, or on any page | Anyone |

A signed-in page reached while signed out (a 401 `not_signed_in` from any route) goes to Sign in
with the note "Your session ended" and, after sign-in, returns to the page that asked. **Only a
path of this site from the table above is ever returned to** (no address typed by anyone else is
followed, no open redirect), and the `/pair` and `/link/source` query is kept with it. The page
that was asked for is never put in the sign-in address and never holds a token.

## What every page has

- **Header:** the product name, then Classes, Devices, Account and "Sign out" (a button that sends
  `POST /api/site/sign-out`). The current page carries `aria-current` and a 3 px bar under it, so
  it is never colour alone. The signed-out pages have the name only. Nothing hides in a menu: at
  phone width the links wrap onto their own row.
- **One `h1`** per page, in `main`; a "Skip to content" link is the first control (visible on
  focus; not in the mock-ups, which show a resting page).
- **Account area:** the four sub-pages sit beside the content at desktop width and above it as a
  row of links at phone and tablet width.
- **Two kinds of message, both with words and a shape.** A **plate** (white, black text,
  `role="alert"`) is for what needs the person: a refusal, a limit, an error. A **note**
  (outlined, `role="status"`) is for "done". Working is a hollow circle and a sentence. Shapes
  never carry meaning alone.
- **Destructive actions confirm in the page**, not in a pop-up: the row or the page is replaced by
  a panel (`role="alertdialog"`) with the consequence in a sentence, the safe button first and
  focused, and the destructive one second. Focus moves to the panel; Esc cancels.
- **Forms:** a visible label above the field (never a placeholder alone), the hint below, the
  error below that with a hollow square and words, and a 4 px border on the field in error.

## Layout at each size

CSS pixels. Under 600 is the phone, 600 to 999 the tablet, 1000 and up the desktop. The page
column is at most 960 px (640 px for the narrow pages: sign-in, pair, connect). Side padding 16,
24, 32 px. The page never scrolls sideways, down to 320 px wide and with the browser's text at
200 % (check S9); sizes are set in `rem` in the product so the browser's own text size works.

| Element | Phone | Tablet | Desktop |
|---|---|---|---|
| Header | Name, then the links on a second row; "Sign out" ends it | One row | One row, 32 px padding |
| Class list | Title on its own line, then length, source and date on one line | Four columns: class, length, from, changed, with column labels | The same, in the 960 px column |
| Row with actions (device, session, passkey, app) | Text, then the buttons beneath | Text left, buttons right | The same |
| Buttons in a form | Full width | Natural width | Natural width |
| Account sub-pages | A row of links above | The same | A column of 200 px on the left |
| Class intervals | Start and length with the zone, the targets and the cue on lines under it | A row: start and length, zone, targets, cue | The same |

Every page is shown at 390, 820 and 1280 px in the mock-ups; the main state of each page is kept
as a picture at all three, the rest at 390 and 1280. The main states are also checked at 320.

## Pages, their states and the routes each element uses

Routes are under `/api/site/` and use the session cookie (ADR 0002, section 5); the request
errors are those of `backend/src/player_backend/site/`. The passkey routes are not merged yet
(issue #130): the names below are **working names** and the Developer of #130 owns the final ones;
the web issue corrects this table to them. Whatever the names, a page needs exactly these
functions: sign-in options and completion, registration options and completion, list, rename and
remove.

### Sign in

The email link, a passkey, and the pages around them. One narrow column.

| State | What the person sees | Route | Mock-up |
|---|---|---|---|
| Start | "Sign in", an email field, "Email me a sign-in link", "or", "Sign in with a passkey" | `POST sign-in/link`; `POST sign-in/passkey/options`, then `POST sign-in/passkey` | [sign-in](mockups/site-sign-in.html) |
| Not an email | Field error "That does not look like an email address", the typed text kept | 422 `invalid_email` | [invalid](mockups/site-sign-in-invalid-email.html) |
| Too many requests | Plate "Too many sign-in requests", "try again in about N minutes" from `Retry-After`; the form stays | 429 `too_many_requests` | [limited](mockups/site-sign-in-limited.html) |
| Check your mail | Note "A link is on its way if *address* can sign in", how long it works (once, 15 minutes, this browser), a hint about spam and spelling, "Send the link again", "Use a different address" | 200 `accepted` | [sent](mockups/site-sign-in-sent.html) |
| **Not on the allowlist** | **The same "Check your mail" page, word for word.** ADR 0002 section 4 fixes that the answer for an address that cannot sign in never differs from one that can, so no page may say "not allowed" (it would tell anyone whether an address has an account). The hint on the page ("Only addresses that have been let in can sign in") is there for every visitor and is how the person learns the reason | 200 `accepted` | [sent](mockups/site-sign-in-sent.html) |
| Link opened | "Finish signing in", a "Sign in" button, "This works only in the browser where you asked for the link". The token is read from the fragment and removed from the address bar; opening the page signs nobody in | `POST sign-in/complete` on the button | [link](mockups/site-sign-in-link.html) |
| Signing in | The button disabled, "Signing you in…" | pending | [working](mockups/site-sign-in-link-working.html) |
| Link expired, used or refused | Plate "This link cannot be used" with the three possible reasons, and the sign-in form to ask for a new link. One page for every refusal (expired, used, unknown, other browser) | 401 `sign_in_refused` | [refused](mockups/site-sign-in-link-refused.html) |
| Waiting for a passkey | "Waiting for your passkey. Follow the prompt from your browser or device", the passkey button disabled | the browser's prompt | [waiting](mockups/site-sign-in-passkey-waiting.html) |
| Passkey failed | Plate "That passkey could not be used", "Try again", and the email form. A 429 shows the "Too many sign-in requests" plate | 401 from `POST sign-in/passkey`; 429 | [failed](mockups/site-sign-in-passkey-failed.html) |
| Session ended | Note "Your session ended" above the form | 401 `not_signed_in` | [ended](mockups/site-sign-in-session-ended.html) |
| Signed out | Note "You are signed out" | `POST sign-out` (204) | [signed out](mockups/site-signed-out.html) |
| Account deleted | Note "Your account was deleted", "Devices remove their saved classes the next time they connect" | `POST account/delete` (204) | [deleted](mockups/site-account-deleted.html) |

A browser without passkey support shows no passkey button and no explanation.

### Classes

| State | What the person sees | Route | Mock-up |
|---|---|---|---|
| List | "Classes" and the count, the filter (from 8 classes), column labels, one row per class: title (a link), length `m:ss` or `h:mm:ss`, source, changed date. **Title A to Z**, case and accents ignored, equal titles by id; never by date or use (rules 10 and 13) | `GET classes` | [classes](mockups/site-classes.html) |
| Loading | "Loading your classes…" | `GET classes`, every page | [loading](mockups/site-classes-loading.html) |
| Empty | "No classes yet", how classes arrive ("In classbeat, choose Connect player"), a button to Linked apps | `GET classes` | [empty](mockups/site-classes-empty.html) |
| Class details | Title; length, sport, music source and song count, source, changed date; "Delete class"; **Time in zone** (zone number in an outlined box, name, time); **Songs** (number, title, artist, length); **Intervals** (start and length, zone as number and name, cadence and position or the running target, the cue text). Read only | `GET classes/{id}` | [detail](mockups/site-class-detail.html) |
| Delete, confirming | Panel "Delete this class?", "It is removed from your library at once, and from each of your devices when it next syncs. It cannot be undone here.", "Keep the class" (default, focused), "Delete class" | `DELETE classes/{id}` | [delete](mockups/site-class-delete.html) |
| Deleted | Back on the list with the note "Deleted “*title*”", "Your devices remove it the next time they sync"; the selection is not kept | 204 | [deleted](mockups/site-classes-deleted.html) |
| Not found | "That class is not here": a deleted class, an unknown id, another account's id and a removal marker all give this | 404 `not_found` | [not found](mockups/site-class-not-found.html) |

Notes: the route answers latest change first, 50 to 200 to a page. The page reads every page and
sorts here, so the order is the title's (see "What the backend would need"). Removal markers carry no
title and are not shown. Every row is one link of at least 44 px height. **No zone colour is used
on the site**: zones are shown as an outlined number and a name (check S4). The planned-load figure
is left out until its name is chosen (rule 9).

### Devices and pairing

| State | What the person sees | Route | Mock-up |
|---|---|---|---|
| List | "Devices" and the count, "Pair a device", one row each: name, platform and version as the app sent them, paired date, last used or "Not used yet", "Revoke" | `GET devices` | [devices](mockups/site-devices.html) |
| Empty | "No devices yet", the steps in the player, "Enter a code" | `GET devices` | [empty](mockups/site-devices-empty.html) |
| Revoke, confirming | The row becomes a panel: "Revoke “*name*”?", "It stops getting classes at once. The classes saved on it are removed the next time it connects." "Keep it" (default), "Revoke device" | `DELETE devices/{id}` | [revoke](mockups/site-devices-revoke.html) |
| Revoked | Note "Revoked “*name*”" and the shortened list | 204 | [revoked](mockups/site-devices-revoked.html) |
| Enter a code | "Type the code shown in the player on your computer", one field for the eight letters (shown in the number face, 32 px, `BCDF-GHJK` style, dashes and case ignored), "Continue". The code is typed, never in the address, and the hint says to type only a code seen on one's own screen | none until Continue | [pair](mockups/site-pair.html) |
| Not a code | Field error "That is not a pairing code. A code has eight letters." | 422 `invalid_code` | [invalid](mockups/site-pair-invalid-code.html) |
| Code not found | Plate "That code was not found": used once, runs out after 10 minutes, and "after five wrong codes in a row this page closes for 15 minutes". **One answer** for a wrong code, an ended or decided pairing and a closed form, because the route gives one; the page does not count tries itself | 404 `pairing_not_found` | [not found](mockups/site-pair-not-found.html) |
| Found | "Pair this device?", **who asks** (platform and version) in a box, "Confirm only if this code is on your own screen right now", the code at 44 px so it can be compared, a name field (1 to 40 characters, prefilled with the platform's name), "Pair this device" and "Not this one". The safe action, "Not this one", is as easy to reach as the other | `POST pairing/find`, then `POST pairing/decide` | [found](mockups/site-pair-found.html) |
| Paired | Note "“*name*” is paired", "The player picks it up within a few seconds. You can close this page." | 200 `approved` | [approved](mockups/site-pair-approved.html) |
| Refused | Note "Nothing was paired" | 200 `denied` | [denied](mockups/site-pair-denied.html) |
| Too many devices | Plate "You have 10 devices already", revoke one then start again in the player, "Go to devices" | 409 `too_many_devices` | [limit](mockups/site-pair-too-many-devices.html) |
| Name not valid | Field error under the name ("A name needs 1 to 40 characters") using the field pattern | 422 `invalid_name` | the field pattern of [invalid](mockups/site-sign-in-invalid-email.html) |

### Account

**Sessions** ([mockups/site-account-sessions.html](mockups/site-account-sessions.html)): the
browsers signed in, each with browser name, started and last used; this browser carries the tag
"This browser" (a word and an outline, never colour) and its button reads "Sign out"; the others
read "End session". "Sign out everywhere" is below. Routes: `GET sessions`, `DELETE sessions/{id}`,
`POST sign-out`, `POST sessions/end-all`. "Sign out everywhere" opens the panel "Sign out
everywhere?", "Every browser is signed out, this one too. Devices running the player stay paired."
([mockup](mockups/site-account-sessions-end-all.html)); it needs a recent sign-in (below).

**Passkeys.** The explanation says the email link always works too.

| State | What the person sees | Route | Mock-up |
|---|---|---|---|
| List | "3 of 10 passkeys", "Add a passkey", rows with name, added date, last used or "Not used yet", "Rename", "Remove" | `GET passkeys` | [passkeys](mockups/site-account-passkeys.html) |
| None | An explanation and "Add a passkey" | the same | [empty](mockups/site-account-passkeys-empty.html) |
| Add | A panel with a name field (1 to 40 characters) and "Add passkey", "Cancel"; the browser's prompt follows | `POST passkeys/options`, then `POST passkeys` | [add](mockups/site-passkey-add.html) |
| Added | Note "Passkey added", "We emailed you to say a passkey was added" (ADR 0002 section 6) | 200 | [added](mockups/site-passkey-added.html) |
| Not added | Plate "The passkey was not added", "Nothing was saved", "Try again" | cancelled, or 422 | [failed](mockups/site-passkey-add-failed.html) |
| Rename | The row turns into a field with "Save" and "Cancel"; focus in the field | `PATCH passkeys/{id}` | [rename](mockups/site-passkey-rename.html) |
| Remove, confirming | Panel "Remove “*name*”?", "You can no longer sign in with it. Email links still work.", "Keep it" (default), "Remove passkey" | `DELETE passkeys/{id}` | [remove](mockups/site-passkey-remove.html) |
| At the limit | Note "You have 10 passkeys", the add button disabled with its reason in words | list | [limit](mockups/site-passkeys-limit.html) |

**Linked apps.** "An app you link can send classes to your account and remove the ones it sent. It
sees nothing else." Rows: name, linked date, last used or "Not used yet", "Revoke"; "1 of 5 apps".
Routes: `GET source-links`, `DELETE source-links/{id}`. States: [list](mockups/site-account-links.html),
[none](mockups/site-account-links-empty.html) ("In classbeat, choose Connect player"),
[revoke, confirming](mockups/site-account-links-revoke.html) ("It can no longer send classes. The
classes already in your library stay.").

**Connect an app** (`/link/source`, narrow). On load `POST source-links/check`; then "Connect
*name*?", what it will be able to do (three bullets from the scope: send classes, remove the ones it
sent, read its own send counts) and one sentence that it sees nothing else, "Connect *name*"
(focused) and "Cancel" (to Linked apps; redirects nowhere). The button sends `POST
source-links/approve`; the page then goes to the address the route returns, and shows a note with
a "Back to *name*" button for when that is blocked. The app's name comes from the route, as text.
States: [ask](mockups/site-link-source.html), [done](mockups/site-link-source-done.html),
[not valid](mockups/site-link-source-unknown.html) (400 `unknown_source`: plate, nothing redirects,
no detail about why), [5 apps already](mockups/site-link-source-limit.html) (409 `too_many_links`).

**Your data.**

| State | What the person sees | Route | Mock-up |
|---|---|---|---|
| Page | "Export your data" (what the file holds), "Download export", "You can export 3 times a day. The file is made when you ask and is not kept." Then "Delete your account", the consequence, "Delete my account…" | | [data](mockups/site-account-data.html) |
| Export started | Note "Your export has started", the file name `class-player-export.json`, "If the file looks cut off, ask for the export again" (the stream stops without an error page) | `POST account/export` | [started](mockups/site-account-export-started.html) |
| Export limit | Plate "No more exports today", "try again in about N hours" from `Retry-After`; the button disabled | 429 | [limit](mockups/site-account-export-limit.html) |
| Delete, confirming | Panel "Delete your account?", what goes, "Type your email address to confirm", the field, "Delete everything", "Keep my account" (the safe one is the way out with Esc) | `POST account/delete` | [delete](mockups/site-account-delete.html) |
| Not the address | Field error "That is not the email address of this account." Nothing was deleted | 422 `confirmation_mismatch` | [mismatch](mockups/site-account-delete-mismatch.html) |
| Deleted | The signed-out page with the note "Your account was deleted" | 204 | [deleted](mockups/site-account-deleted.html) |

The page cannot compare the typed address itself (no route returns it), so "Delete everything"
is enabled once the field is not empty and the server decides.

**Confirm it is you** ([mockup](mockups/site-recent-sign-in.html)). Adding or removing a passkey,
"sign out everywhere", export and deletion need a sign-in within the last 10 minutes (ADR 0002,
section 4). When one of them answers 403 `recent_sign_in_required`, the page shows the plate "Confirm
it is you", "For this change you need to have signed in within the last 10 minutes. After that you
come back here.", with "Use a passkey" and "Email me a link". The action is not repeated for the
person: they press it again.

### Errors

| State | What the person sees | When | Mock-up |
|---|---|---|---|
| Too many requests | Plate "Please wait a little", the wait from `Retry-After` in minutes, "Nothing was changed", "Try again" | 429 with `Retry-After` | [429](mockups/site-error-too-many.html) |
| Offline | Plate "You are offline": what is shown may be out of date, changes wait; the page tries again by itself when the browser says it is online, and "Try again". Content already shown stays; a button that needs the server is disabled and says so | A request fails with no answer | [offline](mockups/site-error-offline.html) |
| Server fault | Plate "That did not work, and it was not your doing", "Try again in a moment. If you were changing something, check that it happened before you repeat it." No code, no technical word | 5xx, or an answer the page does not understand | [server](mockups/site-error-server.html) |
| Not found | "That page is not here", a button to Classes | An address the site does not have | [404](mockups/site-error-not-found.html) |

A 403 `cross_site_request` is not shown as such: it is the server-fault page.

## Keyboard

All of it works with the keyboard alone, in reading order. Links and buttons are real `a` and
`button` elements; a form submits with Enter.

| Key | Where | Does |
|---|---|---|
| Tab, Shift+Tab | everywhere | Skip link, header, content, in reading order; the account sub-links are one group of links |
| Enter, Space | a button | Does it; a link takes Enter |
| Esc | a confirmation panel, the rename field, the add-passkey panel | Cancels and returns focus to the control that opened it |
| `/` | the class list, from 8 classes | Focuses the filter (not while typing in a field) |
| Enter | the pairing code field | Continue |

After an action the focus goes somewhere that exists: to the panel heading when one opens, to the
note when it appears, to the next row when a row goes, to the page heading after a deletion
returns to the list. The focus ring is 3 px `--light-1` with a 3 px gap, above 17 : 1 against
black (S8). Status changes are written into a `role="status"` region (polite); plates are
`role="alert"`.

## Motion

None. Nothing animates: no spinner (a hollow circle and words mean working), no transition on a
panel or a note, no smooth scrolling. So there is no reduced-motion variant to keep.

## Wording

Sentence case; no full stop on a status line, a button or a heading; full sentences keep theirs.
Plain words; no code names (`409`, `too_many_devices`) are ever shown. "Sign in", not "log in".
Buttons say what the press does ("Revoke device", not "OK"). The consequence of a destructive
action is in the confirmation, in the person's terms (what is lost, when the devices find out).
No legal text, no marketing text, no "we value your privacy".

## Measurable criteria

Checked by [mockups/measure.js](mockups/measure.js) on every state at 390, 820 and 1280 px (and at
320 for the main states), at the page's full height; the product's CI screenshots are held to the
same numbers. The font sizes are those at the browser's default text size.

| # | Check | Number |
|---|---|---|
| S1 | Cap height of text (a capital H), in pixels, for the size it is set in | Page title (Big Shoulders 32 px phone, 40 px from tablet): at least 21 px. Headings (26 px): 17 px. Row titles (20 px bold): 13 px. Body text and buttons (18 px): 12 px. Field labels, hints, details, dates (16 px): 10 px. Labels (14 px): 9 px. Lengths and times (Big Shoulders 22 to 26 px): 17 px. The pairing code (32 and 44 px): 26 px. **No text is set below 14 px**, and nothing below 16 px except a label |
| S2 | Contrast of text against the pixels behind it, worst pixel | At least 7 : 1 for everything except labels (14 px, `--light-3`): at least 4.5 : 1. Disabled text is `--light-2` and still 7 : 1. Measured worst pixel on the mock-ups: 7.2 : 1 |
| S3 | What is visible at once, at 390 × 844 and at 1280 × 800 | The header and the page title; for a list, the first three rows and the primary action; for a form, every field and its button without scrolling at 1280 and with at most one scroll at 390; for a confirmation, the whole panel, with the consequence and both buttons |
| S4 | Colour | **No hue anywhere**: the checker's "hue outside a zone" test passes with no zone on the page. A zone is a number in an outlined box and a name |
| S5 | Words with every marker | Every plate, note, status and tag has its words beside it; selection and "current" are a bar, an outline or a word |
| S6 | Nothing is cut | No text is cut or ellipsised; a title wraps, up to four lines at 390 px |
| S7 | Controls | Every button, field, link in a row and header link is at least 44 px high (the primary and form buttons 48 px), with at least 8 px between two |
| S8 | Focus | 3 px outline in `--light-1`, offset 3 px, on every control; never removed |
| S9 | Reflow | No horizontal scroll at 320 px wide, and at 200 % text size |
| S10 | Motion | Nothing animates (the checker's flash-rate and reduced-motion tests pass with no exemption) |
| S11 | Text | All text is live text; nothing is baked into a picture |
| S12 | Structure | One `h1` and one `main` per page; every field has a label; headings do not skip a level |

## What the backend would need (not blocking the design)

Nothing here changes a route this spec relies on; each is a gap the Orchestrator may put into the
web issue or a backend issue.

1. **The passkey routes** (issue #130) are working names; see above.
2. **No route returns the account's email**, so the site never shows it. If "signed in as" is
   wanted, a `GET /api/site/me` is needed.
3. **Title order.** `GET classes` pages by latest change. Until it has a title-ordered cursor the
   page loads every page and sorts here; with many thousands of classes that is slow, and a
   server order would be better. The page lists 100 rows and then "Show 100 more" past that.
4. **The list says which source by id only** (`classbeat`); the display name is known for linked
   apps (`GET source-links`). Until a class carries a name, the id is shown as it is.
5. **No "this device" mark** exists for devices (a browser is not a device), so none is shown.
6. **Pairing wording.** The name field is prefilled from the platform ("macOS computer"); the
   mock-up shows a typed name.
7. **The "download the application" link** of plan section 5 is not in issue #131 and not
   designed here.

## What the site never shows (plan section 3)

| Rule | How these pages keep it |
|---|---|
| 1. Displays a finished class and nothing more | Class details are read only: no edit, reorder, song choice or interval change |
| 2. Software only, never controls equipment | Nothing refers to a bike or a machine; "device" means a computer running the player |
| 3. Spotify's music stays in Spotify's app | The page names the music source and lists songs as text; nothing plays or loads |
| 4, 5. No road, ribbon, terrain or moving viewpoint | No scene and no sensor value |
| 6. None of MOWL's look | Plain text on black; no rings, circles, bars against a line, none of its palette or names |
| 7. Colour is the planned zone | No hue at all (S4); a zone is a number and a name |
| 8. No hand-position icons, no "adjust by heart rate" | The details show `seated` or `standing` as the word the class holds, never as an icon, and no heart-rate advice |
| 9. Own names for load figures | No load figure is shown until its name is chosen |
| 10, 11. Cues are written at design time; nothing from past sessions | The cue text is the class's own; no history, "recently used", suggestions or counts of plays |
| 12. No camera | None |
| 13. Rider data one way; no ranked list | No rider appears on any page; classes are in alphabetical order |
| 14, 15. Join code, no team games | The pairing code is for a device, not a class; no games |
