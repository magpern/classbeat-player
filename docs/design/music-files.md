# Screen spec: the instructor's music files

Status: proposed in the pull request for issue #919, for
[ADR 0017](../adr/0017-local-music-files.md) (sections 2 and 3, issue 3 of its table).
Design system: [system.md](system.md). It extends [class-list.md](class-list.md) (the page)
and [presenter.md](presenter.md) (the window during a class). Reference mock-ups and screenshots:
[mockups/](mockups/), files `class-list-music-files-*` and `presenter-music-*`, written by
`mockups/music-files-pages.js`.

This is the existing stage-light system, not a new direction: black, white and grey, the shared
markers, the white plate, the same type in pixels as the class list. No new token, no hue.

## Purpose

A class whose music is the instructor's own audio files (`music.source` is `local`) can only play
on a computer that holds those files. The instructor needs three things, in the words of someone
about to teach and not looking at a settings screen:

1. **Know before the start whether every file is found**, and if not, how many are missing and
   which songs they are.
2. **Find them**: point the player at the folder where the music is kept, once per computer, and
   see the answer.
3. **Be told calmly if a file fails in the middle of the class**, on the instructor's screen only.

The screens never show where a file is on the disk (rule below) and never name another product.

## Where it sits

- **The class list page, in the footer of the selected class** ([class-list.md](class-list.md),
  "Layout"). The footer already says what Start will do for the selected class; for a local class
  it gains one line, the files line, and one key. The class list has no other new region, so a
  list of Spotify, Swedebeat and manual-clock classes is exactly as drawn there.
- **A row** (a class card): the second line says "Music files, 11 songs" and, after it, the
  files marker and its words (the same place as the mix marker in [swedebeat.md](swedebeat.md)).
- **A panel in place of the list**: the missing songs, opened by "Show which files".
- **The presenter window during a class**: the music line, and a plate in the place of the
  resync notice ([presenter.md](presenter.md), "Music link line").
- **Never the room screen.** The room screen gets no new word, plate, marker or colour. The class
  file's own words (a song title, a file name) are never put on it. After a failure its link line
  is what [room-2d.md](room-2d.md) already draws for the manual clock: grey, square marker,
  "Manual clock". Never the scene, the companion or a phone.
- **Never the phone and tablet apps**: they keep the manual clock for source `local` (ADR 0017
  section 4), so they have no files state.

## Content, in priority order

Footer of a selected local class, before the start:

1. The state in words, with its marker: "All 11 music files are found", "2 music files are
   missing", "Finding music files…".
2. What Start will do, in the grey detail line, with the reason when it will be the manual clock.
3. The keys that fit: "Find music files" (only while a file is missing or a check or search
   runs), "Show which files" (while a file is missing, and held, shown but disabled, in checking,
   choosing and finding alike), and Start.

The list of missing songs, per song, in this order: **title**, **artist**, then the **file name
the class document holds** (`ids.local_file.file_name`), grey, in its own column.

In the presenter window: the music line "Manual clock, music stopped", the song that failed, and
the plate that says it once.

## What is never shown: paths, folders, anything from the disk

**No path, no folder name, no file name from the disk, and no SHA-256 appears anywhere on these
screens.** The only file name shown is `file_name` from the class document, as the hint the
format says it is. The page cannot show more: the shell's answer holds only a song index and
`found` or `missing` (ADR 0017 section 2). So the words never say which folder was chosen
("the folder you chose", never its name), never say where a file was found, and never list found
files by name. Each mock-up checks this by reading: nothing on it comes from a disk.

## Layout

All sizes are CSS pixels of the window's client area, as for the class list: content column at
most 1280 px, centred; side padding 32 px; 1000×720 is the smallest design size.

```
+--------------------------------------------------------------------+
| Classes  12 classes                          [ Open a class file... ] |
| (o) Up to date / Paired as ana@example.com, "Studio PC"              |
| Class                                         Length   Updated       |
|--------------------------------------------------------------------|
| Recovery spin                                  30:00   18 Sep        |
|   Music files, 7 songs   [] 3 files missing                          |
| [Thursday threshold]  (selected)               42:00   Yesterday     |
|   Music files, 11 songs  [] 2 files missing                          |
|--------------------------------------------------------------------|
| Thursday threshold                  [ Find music files ] [ Start class ] |
| [] 2 music files are missing   [ Show which files ]                  |
| Starting opens the room screen and the presenter window. Manual      |
| clock until they are found                                           |
+--------------------------------------------------------------------+
```

Regions of the footer, top to bottom:

- **Title.** The selected class's title, at most two lines, then an ellipsis, as class-list.md.
- **Files line.** The marker, the words (Atkinson 700, 18 px), then "Show which files" when a file
  is missing, or held while a check, a choice or a search runs. It stays on one line while it fits; the key wraps under the words rather than
  shrink. Present only for a local class.
- **Detail.** Atkinson 400, 16 px, light-2, at most three lines: what Start does, and why.
- **Keys.** "Find music files" (raised, 20 px bold) and Start (white, 22 px), right-aligned, side
  by side. Start keeps its place and size from class-list.md.
- **A row's second line.** "Music files, 11 songs", then the marker and "Files found",
  "2 files missing" or "Finding files…", in the style of the mix marker of swedebeat.md.

| Window client size | Layout | Rows fully visible, 12 classes |
|---|---|---|
| 1920×1080 | As drawn; column 1280 px, centred | 11 |
| 1280×800 | As drawn | 7 |
| 1000×720 | As drawn; footer 131 px, 151 with a two-line detail | 6 |

The footer is the one region that changes height with the selected class. The list above it takes
the difference, so a row never moves sideways and the selection stays whole in view.

### The list of missing songs

Takes the body in place of the list and the footer, as a form does:

```
Missing music files                                          (Big Shoulders 800, 40 px)
Thursday threshold: 2 of 11 music files are not found on this computer.
Song                                   File name in the class
Neon Avenue                            neon_avenue_final_v2.mp3
  The Midnight Parade
Pulse Theory                           07 Pulse Theory (radio edit).flac
  Aurora Lane
[ Find music files  Enter ]  [ Back  Esc ]
Files are matched by their content, not by name. Nothing leaves this computer.
```

Two columns, the song (22 px bold title, 16 px grey artist) and the file name (16 px grey). The
list is the only part that scrolls, with an always-visible scroll bar. **Every title, artist and
file name wraps in full**, even 200 characters (the format's limit for title and artist) and a
255-character file name with no spaces (it breaks anywhere); nothing is cut or ellipsised.

## States

### Class list, selected class has source `local`

Each state is read from the per-song answer, `found` or `missing`, and nothing else.

- **All found.** When: every song `found` and checked. Marker and
  words: Filled circle, "All 11 music files are found" ("The music file is found" for one song).
  Keys: Start only. **No "Find music files"**: it is offered only while a file is missing (ADR
  0017 section 2). Footer detail: "Starting plays them from this computer and opens the room
  screen and the presenter window". [found](mockups/class-list-music-files-found.html).
- **Some missing.** When: at least one `missing`. Marker and
  words: Hollow square, "2 music files are missing". Keys: "Show which files", "Find music files",
  Start. Footer detail: "Starting opens the room screen and the presenter window. Manual clock
  until they are found". [missing](mockups/class-list-music-files-missing.html).
- **One missing.** When: exactly one. Marker and words: hollow
  square, "1 music file is missing". Keys: as above. Footer detail: the same, "until it is found".
  [one](mockups/class-list-music-files-missing-one.html).
- **None found.** When: all songs `missing` (a new computer).
  Marker and words: hollow square, "All 11 music files are missing". Keys: as above. Footer
  detail: As "some missing". [none](mockups/class-list-music-files-all-missing.html).
- **Choosing the folder.** When: the operating system's folder
  window is open. Marker and words: hollow circle, "Choose the folder with your music". Keys:
  "Find music files", "Show which files" and Start **held** (disabled, grey). Footer detail: "A window from this
  computer is open. Starting waits until you have chosen".
  [choosing](mockups/class-list-music-files-choosing.html).
- **Finding.** When: the main process is matching. Marker and
  words: Hollow circle, "Finding music files…". Keys: "Find music files", "Show which files" and Start, all held. Footer detail: "Looking in the
  folder you chose and the folders inside it. Starting waits until this is done".
  [finding](mockups/class-list-music-files-finding.html).
- **Checking (in the background).** When: the player checks a class by itself and the row has no
  answer yet, or no folder was chosen. Marker and words: hollow circle, "Finding music files…".
  Keys: all three held, as in "Finding". Footer detail: "Looking for them on this computer.
  Starting waits until this is done" (no folder is spoken of, as none was chosen). Nothing else
  differs from "Finding".
- **Held with an answer.** When: another class is being checked or searched while this row
  already has its answer. The row keeps its own marker and words (found, missing or still
  missing). Start and "Find music files" where it is shown are held, and the footer detail reads "Another class is
  being checked. Starting waits until this is done" in place of the state's own line. "Show which
  files" stays live where a file is missing, as the panel is read from the answer. This holds
  under the failure plate too: the detail line stays, and the plate's "Try again" is held as well.
- **Still missing.** When: a find ended with files missing.
  Marker and words: hollow square, "2 music files are still missing". Keys: as "some missing".
  Footer detail: "They were not in the folder you chose. Choose another folder, or start on the
  manual clock". [still](mockups/class-list-music-files-still-missing.html).
- **Search failed.** When: `player:music-files-find` failed. Marker and words: the previous
  state, plus a **plate** above the list: "The music files could not be searched", detail
  "Nothing was changed. Try again, or start on the manual clock.", key "Try again". Five rows
  still fit at 1000×720, with the plate and with the held-with-answer detail line.
  [failed](mockups/class-list-music-files-find-failed.html).
- **The list.** When: "Show which files" pressed. Marker and
  words: Panel "Missing music files" (above). Keys: "Find music files" (main, Enter), "Back"
  (Esc). [list](mockups/class-list-music-files-list.html),
  [worst case](mockups/class-list-music-files-list-worst.html).

Notes:

- **Finishing a find with every file found** returns to "All found". After a find that found
  nothing new, the state is "Still missing"; after a find that found some, the count drops and
  the words are those of "Still missing". The page never says how many were found by a find: the
  answer is per song, and the count of the missing is the only number needed.
- **Closing the folder window without choosing** returns to the state before, with no message and
  no plate: nothing went wrong.
- **A file that changed or went missing before the start** (ADR 0017 section 2, "Checking before
  playing") is dropped and its song counts as missing: the footer turns to "Some missing" or
  "One missing" at once, with the same words. Pressing Start with a check running waits for it,
  as for "Finding".
- **Start is never refused for missing files.** The class starts on the manual clock, with the
  reason in the footer beforehand and in the presenter window afterwards. A class never plays
  with some songs missing (ADR 0017 section 3).
- **While finding, Start is held.** The answer decides whether the class plays its files or runs
  on the manual clock, so starting in the middle would start on the wrong one. The window does
  not stop the instructor opening another class file or selecting another class; a selection
  change shows that class's own state.
- The longest footer, an 80-character title in wide capitals, is
  [worst footer](mockups/class-list-music-files-worst-footer.html): two lines of title, then an
  ellipsis, and the footer still holds every key.
- A song is `found` only when it is found **and** checked; the page does not tell the two apart.
- Rows of other local classes carry their own state, from their own songs; only the selected
  class's footer ever shows the files line.

### Presenter window, during a class

- **Failed to play.** Lines: "Running" and "Manual clock, music stopped", with the detail
  "Neon Avenue could not be played". Plate: "The music stopped", body "Neon Avenue could not be
  read. The clock keeps running.", key "Close" (Esc).
  [stopped](mockups/presenter-music-stopped.html).
- **Wrong length.** The same lines, with the detail "Neon Avenue is the wrong
  length". The same plate, with the body "Neon Avenue is the wrong length. The
  clock keeps running." [length](mockups/presenter-music-length.html).
- **Closed.** The same lines, no plate. [closed](mockups/presenter-music-closed.html).
- **Started with files missing.** Lines "Running" and "Manual clock", with the detail "2 music
  files were missing when the class started". No plate: a choice made before the start, not a
  fault. [missing at start](mockups/presenter-music-missing-at-start.html).

- The song's title is the class document's own. No file name, no path, no reason from the disk:
  the two reasons above are the only two, and the second is a length check, not a decode error.
- The plate is the system's one alert form (white, black text). It appears in one frame, makes no
  sound, does not repeat and does not return after Close. The clock does not stop, jump or
  show anything different: the instructor carries on.
- The plate stays until it is closed or the class ends; the music line keeps the fact for the
  rest of the class, so closing it loses nothing.
- A second failure cannot happen: the audio has already stopped for the class (ADR 0017
  section 3), and no song plays again until the class is started anew.
- **Fix during the class is not offered**: no "Find music files" during a class (it would open a
  folder window over a running class). The key returns on the class list.
- The room screen during all of these is [room-manual.html](mockups/room-manual.html), the existing
  manual-clock screen, unchanged. This is the preview in each presenter mock-up.

## Keyboard

Tab order on the class list adds, between the list and Start: "Show which files", "Find music
files". Enter on "Find music files" opens the folder window; Enter on the list still starts the
selected class.

- **Enter.** Where: "Find music files" (focused), or in the list panel. Opens the operating
  system's folder window.
- **Esc.** Where: the list of missing songs. Back to the class list, the same class selected.
- **Esc.** Where: the presenter's plate. Close.

Initial focus in the list panel is "Find music files". Focus returns to where it was after a find
ends: to the same key if it is still there, else to the list. The files line is a polite live
region (`role="status"`): a screen reader hears "Finding music files…" and then the result. The
presenter's plate is `role="status"` as the resync notice is.

## Motion

None. A hollow circle means "working" and stays still, as everywhere on this screen; there is no
number or bar because the answer carries no progress, and none is invented. Panels and the plate
appear in one frame, with or without the operating system's reduced-motion setting, and the
class-list rules of [class-list.md](class-list.md), "Motion", hold: nothing animates, nothing
flashes, no smooth scrolling.

## Measurable criteria

Checked by [mockups/measure.js](mockups/measure.js) on every mock-up: the 11 class list pages at
1920×1080, 1280×800 and 1000×720, and the 4 presenter pages at 1280×800 and 1000×720 (41
renderings). These are the class list's own numbers, so a screen is held to the same ones
before and after this change.

- **M1.** Text height (cap height of a capital H). Files line in the footer (18 px bold): at least
  12 px (1.7 % of 720). Class title in the footer and in a missing song (22 px): at least 15 px
  (2.1 %). Keys (17 to 20 px): at least 12 px. Start (22 px): at least 15 px. Details, artists,
  file names, row words (16 px): at least 11 px (1.5 %). Labels and shortcuts (14 px): at least
  9.5 px (1.3 %). Presenter plate headline (18 px bold): at least 12 px; plate body and details
  (15 to 17 px): at least 10 px. **No text is set below 14 px on the class list, 15 px in the
  presenter**.
- **M2.** Contrast, worst pixel. Every word and key: at least 7 : 1 (measured 19.1 : 1 for
  primary text). Labels (`--light-3`): at least 4.5 : 1. Held (disabled) keys are `--light-2` on
  black with a dashed 2 px outline, so they pass the same 7 : 1; the footer's words say why.
- **M3.** What is visible at once. At 1000×720, every state: the header, the status line, the list
  header, **at least five full rows** (four in the worst footer, as class-list.md L3 allows for wide
  capitals) and the whole footer (title, files line, detail, keys); the
  selected row always whole. The list of missing songs shows its heading, its sentence, at least
  **two whole songs** (the worst case, a 200-character title, shows one), both keys and the grey
  line.
- **M4.** Colour. **No hue anywhere**: these screens show no zone, so they use no zone colour
  (rule 7). The state is the marker's shape and the words: filled circle fine, hollow circle
  working, hollow square away.
- **M5.** Words with every marker. Every marker has its words beside it; the plate has its words
  and a key; no state is a colour or a marker alone.
- **M6.** Nothing is cut. No title, line, key, artist or file name is cut or ellipsised, except
  the footer's title (two lines, then an ellipsis, the full title in its row).
- **M7.** Controls. Every key at least 44 px high.
- **M8.** Motion. Nothing animates; the flash-rate and reduced-motion tests pass with no
  exemption.
- **M9.** Text. All text is live text; nothing is baked into a picture.
- **M10.** Nothing from the disk. No mock-up contains a path, a folder name or a hash; the only
  file names are the made-up `file_name` values of the class document.

## Wording

Sentence case, no full stop on a line or a key ([presenter.md](presenter.md)); the two plate
bodies and the detail lines that are whole sentences keep their full stops. "Music files" is the
name of the source and of the keys, everywhere. "Missing" is the only word for a file that is not
found, whether it never was or went away. "Found" is never used for a file the player has not
checked. The words do not say "local", "SHA", "index", "folder path" or "scan".

## What the screens never show (plan section 3)

- **1. A finished class and nothing more.** No song choice, no replacement file, no reordering:
  the class names its songs.
- **2. Never controls equipment.** Nothing refers to a bike or a machine.
- **3. Spotify's music stays in its app; the instructor's own files stay on their device.** The
  files line speaks of "this computer"; no song, file or path is sent anywhere, and a Spotify or
  Swedebeat row never shows a files marker. No audio from our server is named or implied.
- **4, 5. No road, terrain or moving viewpoint.** No scene.
- **6. Its own look.** Plain words, markers and a plate on black.
- **7. Colour is the planned zone.** No hue (M4).
- **8, 9.** No hand-position icon, no load figure.
- **10, 11.** No cue and no history: no "last played", no "most used", no "recently found".
- **12. No camera.**
- **13, 14, 15.** No rider data, join code or team on these screens; the room screen is untouched.

## Open questions

- **Cancelling a find.** ADR 0017 section 2 gives the channel no way to stop a search that walks
  20 000 files and hashes them. These screens therefore have no "Stop". If issue 4 adds one, the
  finding state gains "Stop" (Esc) beside the held keys, and nothing else changes.
- **One display.** With one display the presenter window lies behind the room screen
  ([presenter.md](presenter.md)), so an instructor teaching from the room screen's own controls
  does not see the plate. ADR 0017 forbids the notice on the room screen. The room's link line
  turns to the existing grey "Manual clock" (the audio stopped; the class goes on), and the
  presenter window holds the reason. Whether the instructor needs more on one display is the
  owner's, for `docs/owner.md`; this spec does not relax the rule.
- **Search that hits the 20 000-file limit.** The answer holds only found or missing per song, so
  the page cannot say that part of a large folder was left unread. The "Still missing" detail
  suggests another folder; a smaller, closer folder is the usual fix.
