# Screen spec: the class list

Status: proposed in the pull request for issue #116. Design system: [system.md](system.md).
Neighbouring specs: [room-2d.md](room-2d.md) (what Start opens) and [presenter.md](presenter.md)
(wording convention). Reference mock-ups and screenshots: [mockups/](mockups/), files
`class-list-*.html` and `class-list-*.png`, one per state.

## Purpose

The screen the instructor sees before a class, in the computer's own window (plan section 12,
PL4: "class list, offline cache, open a class file"). It answers three questions in this order:
*which class do I teach, is this computer in step with my library, and how do I start.* It
lists the classes cached by sync ([core/sync/](../../player/app/src/core/sync/)), opens a class
file from disk, shows the pairing and sync state, and starts a class, which opens the room
screen and the presenter window.

It is read at arm's length on a laptop or a studio PC, not from across a room, so it follows
the presenter window's convention (presenter.md): sizes in pixels, the room-distance heights
(room-2d.md C1) do not apply, and the same design tokens do.

It is a list of finished classes and nothing more (rule 1): no editing, no reordering, no song
choice, no zone profile, no rider data, no ranking (rule 13).

## Where it sits

- It is the application's first window after start-up. With one class started, the presenter
  window takes the main window's place (presenter.md, PL5); how the instructor gets back to the
  list is the presenter's spec. This spec fixes what the list shows when it is open while a class
  is pinned (state "Class playing", below).
- **Start** opens the room screen in its own window and the presenter in this one. It sends the
  class's id and hash to the shell, which pins that snapshot (`pin` in `sync-model.ts`) before
  anything opens. A pin that is refused (the class changed or was wiped in between) closes
  nothing and starts nothing: the list refreshes and the row is shown as it now is.
- **Open a class file** is the operating system's own file dialog. A file that reads
  (`readClassText` in `core/class-file.ts`) goes straight to the room screen's "before the
  start" state and the presenter, as a snapshot that is **not** in the list, not cached and
  not pinned. A file that does not read leaves the list as it was and shows the message
  (state "Class file not opened").
- **Where the room window goes.** On the display the instructor last moved it to in this session,
  while that display is still connected and is not the presenter's; otherwise on the largest
  display other than the presenter's, in full screen. With one display, the room screen is a 16:9
  window inside the work area, at most 1280 px wide and at least 480x270 (smaller only when the
  work area is), in the largest free part to the right, left, below or above the presenter, so it
  never covers the presenter. When no free part holds 480x270, the window goes behind the
  presenter, which is raised above it so none of its controls is covered. The presenter is raised
  only in that case, and it takes the keyboard only when the application already has it: a class
  opened while another application has the focus leaves that focus where it is. Beside the
  presenter nothing is raised or focused. It is a rehearsal view: room-2d.md's room-distance
  heights (C1) and its 720-line minimum do not apply to it, while contrast, overlap and zone
  checks still do. The window is shown without taking the keyboard from the presenter. There is no
  display picker in this version; the instructor moves the window.
- **When the room window closes, and how it comes back.** It closes when the instructor is on the
  class list with no class pinned. While a class is pinned the list offers "Back to the class" and
  the room stays. When the class ends it stays on "Class Complete" for as long as the instructor
  stays in the class; if the class ends while the instructor is on the list, it closes then. A
  class opened from a file is never pinned, so it closes when the instructor returns to the list.
  Closing the presenter closes the room window and quits the application. A room window closed by
  hand comes back with "Back to the class" or with File > "Show the room screen"
  (CmdOrCtrl+Shift+R). That menu item is greyed out whenever the room window may not open (no
  class open, or the instructor is on the list with no class pinned) and enabled otherwise.

## Content, in priority order

1. **The classes**: one row each, with title, length and when it was updated (the list).
2. **Start**: what the selected class is and the one control that starts it.
3. **Sync and pairing state**: one line, in words, with a marker; a plate when it needs the
   instructor.
4. **Open a class file.**
5. **The filter** (from eight classes) and the count; hidden while the file-error plate is shown
   at 1000×720, so five rows stay whole.

Items 1 to 4 are visible at once in every state with classes, at every size below. Nothing in
the window is behind a menu.

## Layout

All sizes are CSS pixels of the window's client area. The content column is at most 1280 px
wide, centred; side padding 32 px; vertical order is fixed.

```
+--------------------------------------------------------------------+
| Classes  12 classes                          [ Open a class file... ] |
| (o) Up to date                                                       |
|     Paired as ana@example.com, "Studio PC"                           |
| [ Find a class                              / ]   3 of 42   (8+ only)|
| Class                                         Length   Updated       |
|--------------------------------------------------------------------|
| Thursday threshold                             42:00   Yesterday     |
|   Spotify, 11 songs                                                  |
|[Monday morning endurance]  (selected)          45:00   9 Nov        |
|   Spotify, 12 songs                                                  |
| ...                                  (this region scrolls)           |
|--------------------------------------------------------------------|
| Monday morning endurance                          [ Start class  Enter ] |
| Starting opens the room screen and the presenter window              |
+--------------------------------------------------------------------+
```

| Window client size | Layout | Rows fully visible (12 classes / 42 classes with the filter) |
|---|---|---|
| 1920×1080 | As drawn; column 1280 px, centred | 11 / 10 |
| 1280×800 | As drawn | 7 / 6 |
| 1000×720 (the player's default window less its title bar, and the smallest) | As drawn | 6 / 5; 5 rows is the minimum when a plate is shown (expired, file error) |

The class list keeps the presenter's minimum window size, 1000×720, because both use the same
window; nothing smaller is a design size. The shell sets that minimum (#123, merged in #126).

| Region | Content | Behaviour |
|---|---|---|
| Header | "Classes" (Big Shoulders 800, 40 px), the count in grey, "Open a class file…" with its shortcut | Always there; the count is the number of cached classes, or "1 class" |
| Status | A marker and one line of words, a grey detail line; or a white plate with a button | See "States" |
| Filter | A text field and, once typed in, "n of N" | Only from 8 classes; absent otherwise; hidden while the file-error plate is shown at 1000×720, so five rows stay whole |
| List header | "Class", "Length", "Updated" in grey 14 px | Fixed, outside the scrolling region |
| List | Rows, sorted by title A to Z | The only region that scrolls (always-visible scroll bar, `scrollbar-width: auto`) |
| Footer | The selected class's title (at most two lines, then an ellipsis; the full title is in its row) and the Start button | Fixed; absent where there is no list |

Rows grow with their content: a title may take up to four lines before it would be cut (the worst
case, 80 wide capitals, takes
three at 1000 px wide: mock-up "Long titles"). Nothing else changes size.

### A row

```
Title of the class, up to 80 characters, wrapping                 42:00   Yesterday
Spotify, 11 songs   [Playing now]  [Newer version after this class]
```

| Element | Face and size | From |
|---|---|---|
| Title | Atkinson 700, 22 px, light-1 | `document.class.title` |
| Second line | Atkinson 400, 16 px, light-2: "Spotify, 11 songs", or "Swedebeat, 9 songs", or "Manual clock, no music" when `music.source` is `none` | `document.music.source`, `document.songs.length` |
| Length | Big Shoulders 600, 26 px, right-aligned, `m:ss` or `h:mm:ss` (`clockText`, core/format.ts) | `document.class.length_ms` |
| Updated | Atkinson 400, 16 px, light-2: "Today", "Yesterday", "9 Nov", and with the year when it is not this year ("14 Dec 2025"); the device's local date | the class's `published_at` |
| Tags (only on the pinned row) | Atkinson 700, 14 px, outlined, light-1 | `SyncView.pinned` |

A class with `sport: "running"` (PL10) gets the word "Running" first in its second line.
Nothing on a row is coloured: hue means a planned zone and nothing else (rule 7), and this screen
carries no zone.

**Selected row:** a 6 px white bar on its left edge and the raised background (`--stage-raised`);
with the keyboard focus in the list it also has a 3 px white outline. Selection is never colour
alone.

**Order:** title A to Z, compared without regard to case or accents; equal titles by id. No
row is ever moved because of when it was updated, started or played. The order does not change when
a sync adds or updates a class, except that
the class appears where its title puts it; the selection stays on the same class (by id), and
the row is scrolled into view only when the instructor moved the selection.

**Filter:** a case- and accent-insensitive "contains" on the title. It narrows the list as typed;
the count reads "3 of 42". No match: the panel in the mock-up "Filter with no match" replaces
the list and the footer.

## States

The body is chosen in this order: (0) cache unreadable (`unavailable`), (1) cache being wiped, (2)
pairing in progress, (3) not
paired, (4) paired. In (4) the status line follows `SyncView.status`. The marker shapes are
white and carry no hue: a filled circle for "fine", a hollow circle for "working", a hollow
square for "away" (a normal state with no action). A **white plate with black text** is for the
states that need the instructor (the system's only alert form, as on the room screen).

| State | Data | Status line (sentence case, no full stop, presenter.md) | Body | Mock-up |
|---|---|---|---|---|
| Up to date | `status: synced` | Filled circle, "Up to date", detail "Paired as *email*, “*device*”" (the device name only when there is one) | List, footer | [synced](mockups/class-list-synced.html) |
| Syncing, with classes | `status: syncing`, `classes > 0` | Hollow circle, "Syncing", detail "Checking for new and changed classes" | List, footer: classes start while syncing | [syncing](mockups/class-list-syncing.html) |
| First sync | `status: syncing`, `classes: 0` | Hollow circle, "Syncing", detail "Paired as *email*, “*device*”" | Panel "Getting your classes" | [first sync](mockups/class-list-first-sync.html) |
| Offline | `status: offline` | Hollow square, "Offline", detail "Showing the classes saved on this computer. Trying again later." Not a plate: offline is a normal state (plan, "Offline") | List, footer | [offline](mockups/class-list-offline.html) |
| Refused or failing | `status: waiting` (a 429 with its Retry-After, a 5xx, or an answer the player does not understand) | Hollow square, "Sync is waiting", detail "The server is busy or not answering well. Trying again later. Saved classes still play." No number of seconds is shown | List, footer | [waiting](mockups/class-list-waiting.html) |
| Saved classes cannot be read | `status: unavailable` (a local disk fault reading the cache; the files are kept and the read is retried with the fault backoff, #121); `classes: 0` | **Plate** "The saved classes could not be read", detail "They are still on this computer. Trying again soon. You can still open a class file." | Panel "Classes not available": "Nothing was deleted. If this stays, restart the player or check the computer's disk." No list, no Start; Open a class file still works. It never says "no classes" or offers pairing: the classes are there | [unavailable](mockups/class-list-unavailable.html) |
| Saved classes cannot be reached (lasting) | `status: unavailable` with `SyncView.unavailable: "lasting"`: the read failed with a fault that reading again finds unchanged (`ENOTDIR`, `EISDIR`; `core/sync/fault-policy.ts`), shown from the first failed read; the read is still retried; `classes: 0` | **Plate** "The saved classes cannot be reached", detail "They are still on this computer, but the player cannot reach them. Restart the app; if it keeps happening, reinstall it." | Same panel as above: "Classes not available": "Nothing was deleted. If this stays, restart the player or check the computer's disk." No list, no Start; Open a class file still works | unavailable-lasting (screenshot state) |
| Pairing ran out | `status: expired`; `PairingView.paired.pairAgain` | **Plate** "The pairing with *email* has run out", detail "Pair again to get new and changed classes. Saved classes still play.", button "Pair again" | List, footer (the cache is kept) | [expired](mockups/class-list-expired.html) |
| Not paired | `PairingView.unpaired`, no message | Hollow square, "Not paired", detail "Your classes are on the player website. Pair this computer to bring them here." | Panel "No classes on this computer", primary "Pair this computer" | [not paired](mockups/class-list-not-paired.html) |
| Asking for a code | `PairingView.starting` | Hollow circle, "Asking the server for a code…" | Panel, Cancel (Esc) | [asking](mockups/class-list-pairing-start.html) |
| Pairing | `PairingView.waiting` | Hollow circle, "Waiting for the code to be confirmed on the website", detail "The pairing page was opened in your browser" | The code at 76 px (it is typed on another device), the page address, three steps, "The code runs out in m:ss" from `secondsLeft`, "Open the page again", Cancel (Esc) | [pairing](mockups/class-list-pairing.html) |
| Unpaired on the website | `PairingView.unpaired` with `message` (`revoked_on_site`, or any other `NOTICE_TEXT`) | **Plate** with the notice text verbatim from `NOTICE_TEXT`; for `revoked_on_site` and `unpaired` a detail "The classes saved here were removed." | Panel "Pair this computer to get your classes", primary "Pair this computer" | [revoked](mockups/class-list-revoked.html) |
| Cache being wiped | `wipePending` | Hollow circle, "Clearing the saved classes", detail "This computer was unpaired. The classes saved here are being removed." | Panel "One moment": "Nothing can start until this is done. You can still open a class file." No list, no Start, no pairing button until it is done | [wiping](mockups/class-list-wiping.html) |
| Empty | `status: synced`, `classes: 0` | As "Up to date" | Panel "No classes yet": "Classes you send to the player appear here. The list checks again every 5 minutes." (`SYNC_EVERY_MS`), "Open a class file…" | [empty](mockups/class-list-empty.html) |
| Long list | `classes ≥ 8` | As the state of the sync | Filter, scrolling list, a scroll bar that is always visible | [long list](mockups/class-list-long-list.html) |
| Filter with no match | filter text, no rows | unchanged | Panel "No class matches “*text*”": "Check the spelling, or press Esc to clear the filter." | [no match](mockups/class-list-no-match.html) |
| Long titles | 80-character titles, wide capitals, one unbroken word | unchanged | Rows grow to the lines they need; footer clamps to two lines | [long titles](mockups/class-list-long-titles.html) |
| Class playing | `SyncView.pinned` is set | As the state of the sync | The pinned row, in its own A to Z place, marked "Playing now" and carrying the bar and outline of the selection (it is not moved to the top), with "Newer version after this class" when `after: "newer"` or "Removed: plays to the end" when `after: "removed"`; every other row greyed (light-2) and not startable; the footer button reads "Back to the class" and the line under the title "Other classes can start when this one has ended" | [class playing](mockups/class-list-pinned-newer.html) |
| Class could not be updated | The server answered `unusable` for the class (#113): it is skipped, the older cached copy stays and nothing is marked newer (`SyncView` has no flag for it today, see "Data") | Unchanged ("Up to date": sync itself went well) | That row's second line carries the outlined tag "Could not be updated: older copy shown"; the class still starts, as the copy it is. The tag goes when a later sync keeps a version. No ranking, no rider data, no count of failures | [not updated](mockups/class-list-not-updated.html) |
| Class file not opened | a failed read | A **second plate** under the status: the message (`INVALID_MESSAGE`, `NOT_JSON_MESSAGE`, `TOO_LARGE_MESSAGE` or `NEWER_VERSION_MESSAGE`), the file's name, up to five `details` lines, "Close" (Esc) | The list as it was | [file error](mockups/class-list-file-error.html) |

Notes on the states:

- **Sync never hides a class.** Offline, waiting and expired leave the list whole and every
  class startable; only the server's own word removes a class (`sync-model.ts`).
- **Pairing takes the whole body** while it is going, over a cached list too (pairing again
  after an expiry). Cancel (Esc) returns to the list as it was.
- **A newer version of a class** is never applied under a running class (plan, "A class being
  played is pinned"). The list shows it only on the pinned row, as above; every other class
  simply shows its newest cached version.
- Status changes are written into one live region (`role="status"`, polite) so a screen reader
  says "Up to date" or "Offline" once; the file-error plate is `role="alert"`.

## Keyboard

Everything is reachable and usable with the keyboard alone, in this order of Tab:
Open a class file, the status button (Pair this computer, Pair again, Cancel, Close) where there
is one, the filter, the list, Start. The list is one Tab stop.

| Key | Where | Does |
|---|---|---|
| Up, Down | list | Moves the selection one row; the row scrolls into view, instantly |
| Home, End | list | First, last row |
| Page Up, Page Down | list | One screenful |
| Enter | list or Start | Starts the selected class |
| `/`, or Ctrl+F (Cmd+F) | anywhere but the filter | Focuses the filter (from eight classes) |
| Esc | filter | Clears the text; with the filter already empty, returns to the list |
| Esc | pairing, file-error plate | Cancel, Close |
| Ctrl+O (Cmd+O) | anywhere | Open a class file… (also in the application menu) |
| Typing a letter | list | Moves the focus to the filter with that letter typed (from eight classes); with fewer classes, jumps to the next title starting with it |

The focus ring is 3 px `--light-1` (outline offset 2 px on buttons, inside the row on the
list), at least 3 : 1 against its neighbours everywhere (measured above 17 : 1). A click selects a
row; **only** Enter, or the Start button, starts. A double-click does not start a class.
Initial focus: the list, with the first row selected (or the previously started class, when it
is still there); with no classes, the primary button of the panel.

## Measurable criteria

Checked by the mock-up checks in [mockups/measure.js](mockups/measure.js) on every state at
every window size below (57 renderings: 19 states at three sizes); the product's CI screenshots are
held to the same
numbers.

| # | Check | Number |
|---|---|---|
| L1 | Cap height of text (a capital H in its face), as pixels and as a share of the window height at 1000×720 | Row title and the selected class's title in the footer (22 px type): at least 15 px (2.1 %). Status line and plate headline (20 px): at least 14 px (1.9 %). Buttons (17 px; Start 22 px): at least 12 px (1.7 %); Start at least 15 px. The code in the pairing state: at least 40 px (5.6 %). Length (Big Shoulders 26 px): at least 18 px (2.5 %). Second lines, details, dates (16 px): at least 11 px (1.5 %). Labels, column heads, shortcuts, tags (14 px): at least 9.5 px (1.3 %). **No text is set below 14 px** |
| L2 | Contrast of text against the pixels behind it, worst pixel | Titles, lengths, status line, buttons, details, dates: at least 7 : 1. Labels (14 px grey, `--light-3`): at least 4.5 : 1. The measured worst pixel on the mock-ups is 19.1 : 1 for primary text |
| L3 | What is visible at once | Header with count and Open, status, list header, at least **5 full rows** and the footer with Start, at every size with titles that fit one line (the table above: 5 to 11 rows; 5 rows is the minimum when a plate is shown (expired, file error) at 1000×720; the worst case of wide capitals at 1000×720 shows 4); the selected row always fully visible |
| L4 | Colour | **No hue anywhere** on this screen (the checker's "hue outside a zone" test, which every element must pass): it shows no zone, so it uses no zone colour (rule 7). States are carried by words and by the marker shapes |
| L5 | Words with every marker | Every marker, plate and tag has its words beside it; the selected row also carries the bar and the outline |
| L6 | Nothing is cut | No title, status, detail or button text is cut or ellipsised, except the footer's title (two lines, then an ellipsis, with the full title in the selected row) |
| L7 | Controls | Every button and the filter at least 44 px high |
| L8 | Motion | Nothing animates. The checker's flash-rate and reduced-motion tests pass with no exemption |
| L9 | Text | All text is live text in the page; nothing is baked into a picture |

## Motion

There is no motion on this screen, so it has no reduced-motion variant to maintain: markers do
not spin or pulse (a hollow circle means "working" and stays still), a selection moves at once,
the list scrolls to a row instantly with or without the operating system's reduced-motion
setting (no smooth scrolling), plates and panels appear without a transition, and the pairing
countdown changes its text once a second. The score's moving strip belongs to the room screen.

## Wording

Sentence case, no full stop on a status line or a button, plain words, "One line, one fact":
presenter.md. Plates that carry a whole sentence from the player's own notices
(`NOTICE_TEXT` in `core/pairing/view.ts`, the file messages in `core/class-file.ts`) keep their
full stops, verbatim, so the words match what the shell already says. The existing pairing
panel's lines ("Not paired", "Asking the server for a code…", "Waiting for the code to be
confirmed on the website") are reused unchanged. The product's name is not set here; the
window's title bar carries it.

## Data each element needs

What `player/app/src/core/sync/` and its neighbours give. The renderer must only ever hold a view
built field by field, as `SyncView` and `PairingView` are: no token, no document body beyond the
fields below, no account key. The gaps this spec first listed were closed by #132 (merged).

| Element | Source |
|---|---|
| Status line (paired) | `SyncView.status` (`unpaired`, `syncing`, `synced`, `offline`, `waiting`, `expired`, `unavailable`), with `SyncView.unavailable` (`passing` or `lasting`) |
| Pairing, code, countdown, notices | `PairingView` (`state`, `userCode`, `page`, `secondsLeft`, `message`, `email`, `deviceName`, `pairAgain`), `NOTICE_TEXT`, `clockText` |
| Header count | `SyncView.classes` |
| Pinned row, "Newer version", "Removed" | `SyncView.pinned.{id, after}` |
| Rows | `classListView` in `core/sync/class-list.ts`: `{id, hash, title, lengthMs, sport, source, songs, updated, playing, newer, notUpdated}`, only those fields, sorted A to Z |
| Row: updated | `published_at` kept with each cached class (an optional field in the cache file), in the row's `updated`, shown through `updatedText` in `core/sync/updated-text.ts` |
| "Could not be updated" tag | `SyncView.notUpdated` and the row's `notUpdated`, cleared for an id when a version is kept again or the class is removed |
| Cache being wiped | `SyncView.wiping` |
| Start | `pin` event (`id`, `hash`): the pin is of the version the instructor saw |
| Open a class file | `readPicked`, `readClassText`, and the four messages in `core/class-file.ts` |

## What the screen never shows (plan section 3)

| Rule | How this screen keeps it |
|---|---|
| 1. Displays a finished class and nothing more | No editing, reordering or song choice; a class is listed and started as it is |
| 2. Software only, never controls equipment | Nothing on the screen refers to a bike or a machine |
| 3. Spotify's music stays in Spotify's app | The list names the music source only ("Spotify, 11 songs"); nothing plays or loads here |
| 4, 5. No road, ribbon, terrain or moving viewpoint | There is no scene and no sensor value |
| 6. None of MOWL's look | A plain list on black; no rings, no rider circles, no bars against a target line, none of its palette or names |
| 7. Colour is the planned zone | No hue at all (L4) |
| 8. No hand-position icons, no "adjust by heart rate" | None |
| 9. Own names for load figures | The list shows no load figure |
| 10, 11. Text cues written at design time; nothing from past sessions | The list shows no cue and no history: no "last taught", no "most used", no suggestions; the order is the title's |
| 12. No camera | None |
| 13. Rider data one way; no ranked list | The list is the instructor's own classes in alphabetical order. No rider appears on it; no count of riders, no "popular" |
| 14, 15. Join code, no team games | None |
