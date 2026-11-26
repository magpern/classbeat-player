# 0017. Local music files: the instructor's own audio files, played by the player

Status: Proposed. Becomes Accepted when a Reviewer passes its pull request.

## Context

The owner, 2026-11-26: besides Spotify and Swedebeat, a class may use "plain local mp3", the
instructor's own audio files. Classes are still designed in classbeat. This ADR rests on:

- **Plan section 3, rule 3**, with the owner's addition of 2026-11-26 made in the same pull
  request as this ADR: "An audio file the instructor keeps on their own device may be played by
  the player, and never leaves that device." The rest of the rule is unchanged: Spotify's music
  stays in Spotify's own app, and no class audio or video is ever streamed from our server.
- **Plan section 4, option E**: when the player plays the audio itself, the position is exact and
  there is no link to lose. ADR 0013 builds that path for a Swedebeat mix: the mode policy, the
  fallback to the manual clock, the main-process protocol handler that serves audio to the room
  window, and the class clock that follows the played position.
- **ADR 0003**: `music.source` is `spotify`, `swedebeat` or `none`, one source per class; each
  song has optional provider `ids`. Format versions are `1.0` to `1.3`.
- **ADR 0001**: each song owns a window of class time; the crossfade the class was designed for is
  `music.design_crossfade_ms`.
- **ADR 0003 section 7**: a minor version only adds optional fields; the player refuses an
  unknown major with "This class needs a newer version of the player".
- **AGENTS.md section 8**: tests never touch the network or a real account.

## Decision

### 1. The class format: source `local` (format 1.4)

A new value of `music.source` is more than an optional field, so this ADR amends ADR 0003
section 7 (section 8 below): **a minor version may also add a value to `music.source`.** A reader
that meets a `music.source` value it does not know lists the class with the same plain message as
for an unknown major, "This class needs a newer version of the player", and keeps playing its
other classes. A player-lane pull request makes the player's reader do that, before the
contract pull request merges: today the schema's enum and the class list's `SOURCES`
(`player/app/src/core/sync/class-list.ts`) refuse the value and the class is not listed. A player built before that change does not list a class with source
`local`.

A contract pull request then adds, in format version `1.4`:

- `music.source` may be `local`.
- `songs[].ids.local_file`: `{ "sha256": 64 lowercase hex characters, "size_bytes": a positive
  integer, "file_name": 1 to 255 characters, no path separator }`. The SHA-256 is of the whole
  file's bytes. The file name is only a hint shown to the instructor; matching never uses it.
- Semantic rules: with source `local`, every song has `ids.local_file`; `ids.local_file` appears
  only with source `local` and format `1.4` or later; a format before `1.4` has no source `local`.
- Nothing else about a song changes: title, artist, length, window and beat anchors are as for any
  source. Where the anchors and the song timing come from is classbeat's business (Consequences).

### 2. Finding the files on a device

The instructor shows the player where the files are, once per device:

- **Picking.** On a class with source `local` whose files are not all found, the instructor's
  class page offers "Find music files". It calls one new IPC channel,
  `player:music-files-find`, admitted only from the instructor's window (`core/ipc-policy.ts`),
  never from the room window. It takes the class id and nothing else. The main process opens the
  operating system's own folder dialog, matches, and answers only, per song index, `found` or
  `missing`. No renderer, IPC answer, log line or error text ever holds a path, a folder name or
  a file name from the disk; the page shows the `file_name` from the class document.
- **Matching.** The main process walks the chosen folder and its subfolders (at most 20 000 files,
  symbolic links not followed), skips any file whose size does not equal a wanted `size_bytes`,
  and hashes the rest. A file matches a song when its SHA-256 equals the song's. Name, tags and
  date are never used to match.
- **Remembering.** Per classbeat-player account, the player keeps a local index `sha256 → (path,
  size, modification time)` in its app data folder, beside the class cache and wiped with it.
  The chosen folders are kept in the same index store, so a new class's files are found without
  asking again.
- **Checking before playing.** Before a class starts, each song's indexed file is checked: same
  size and modification time as indexed, or else hashed again. A file that changed or went
  missing is dropped from the index and its song counts as missing.
- **What leaves the device: nothing.** The audio, the paths, the folder names, the index and which
  songs were found are never sent to the backend, a live session, a log or a crash report. Inside
  the device, the paths and the index stay in the main process; the room window's renderer gets
  only the audio bytes of the song now playing, through the scheme in section 3. The backend keeps
  only the class document as the source sent it.

### 3. Playing

- **The mode.** The mode policy (`core/mix/mode-policy.ts`, ADR 0013 section 4) gains a third
  case: `music.source` is `local` and every song's file is found and checked: **local playback**,
  a new `MusicLink` kind, `local`. Otherwise **the manual clock**, with a plain reason on the
  instructor's screen ("2 music files are missing") and the list of missing songs (title, artist,
  `file_name`), and "Find music files" again. A class never plays with some songs missing. A
  Spotify, Swedebeat or soundless class never uses local playback, and a local class never uses
  the Spotify link or mix playback.
- **The scheme.** The main process registers one more scheme, `cbp-local:`, as standard, secure
  and supporting fetch and streaming, **without `bypassCSP`**, and answers it with
  `protocol.handle`.
- **One song, one play id.** When the room window starts a song, the main process issues a play
  id, 128 random bits, bound to that window's `webContents` id, the account, the class and the
  song index, and sends the room window `cbp-local://play/<play id>`. The handler answers only a
  live play id, with byte-range support, reading the indexed, checked file, with
  `Cache-Control: no-store`. The URL never holds a path, a file name or a SHA-256. A play id ends
  when its song stops, the class stops or changes, the room window closes or the account signs
  out. The player copies, converts or caches no audio: the file is read where it is.
- **The request filter.** The allowlist of ADR 0013 section 5 gains one case: a `cbp-local:` URL
  only when `details.webContentsId` is the room window's id and the play id is live and bound to
  that window. Every other `cbp-local:` request is cancelled.
- **The page.** The shell's room code (`player/app/src/renderer/`, never `player/scene/`) plays the
  songs with two `<audio>` elements, so two songs can overlap. The room page's
  Content-Security-Policy becomes `media-src cbp-mix: cbp-local:` and nothing else; every other
  window keeps `media-src 'none'`, and `connect-src` stays `'none'` everywhere.
- **Timing.** The format has no in-point: every song plays from its own position 0. Song k starts
  at its `start_ms` and stops at the earliest of its own end, `end_ms + design_crossfade_ms` and
  the class end. When the next song starts during song k, song k fades out and the next fades in,
  equal-power, over the time they overlap. Class time follows ADR 0001's rules: while song k
  plays at position p it is `start_ms + p`, held at `end_ms`; from the moment the next song
  starts, the incoming song owns the overlap (ADR 0001 rule 3). The readings are always fresh, so
  the position is exact. Pause, nudge and skip act on the player's own audio and the class
  together.
- **Length check.** The room reports each file's decoded length. A file more than 1 000 ms from
  the song's `length_ms` makes the song missing only when two reports in a row agree, as for a
  mix (ADR 0013, amendment for #693). Before the class starts, each file is opened once in the
  room window to get that report.
- **Errors while playing.** A file that fails to read or decode, or a length check that fails,
  mid-class: the audio stops at once, the class clock stays where it is and continues on the
  manual clock, with a calm notice on the instructor's screen, never on the room screen.

### 4. Where it runs

The desktop player first. The phone and tablet apps keep the manual clock for source `local`
until a later issue gives them their own file picking (their file access differs and is not
decided here).

### 5. Guards

- The player's network guard covers every test of this feature.
- The hardening tests pin, as allowlists: the `cbp-local:` scheme's privileges (no `bypassCSP`);
  the request filter's room-window case (a `cbp-local:` request from any other window, with an
  unknown or ended play id, or after sign-out, is cancelled); the room page's CSP and every other
  page's; and `player:music-files-find` admitted only from the instructor's window, with an
  answer that holds only song indexes and `found` or `missing`.
- A test plants a known byte pattern and a known folder name in fake music files, plays a fake
  class, and checks that no request body, IPC answer, log line, live message or stored file other
  than the index holds the pattern, the path or the folder name.
- Test audio is a generated, licence-free tone file from the test fixtures; no real song is ever
  committed.

### 6. The issues

| # | Lane | What | Security-critical | Depends on |
|---|---|---|---|---|
| 1 | player | The class list's reader lists a class with an unknown `music.source` as "This class needs a newer version of the player" | No | this ADR |
| 2 | contract | Format 1.4: source `local`, `ids.local_file`, the semantic rules, generated types, converter fixtures | No (rule-sensitive) | 1 |
| 3 | docs | Design spec for the instructor's "music files" state: found, missing, finding | No | this ADR |
| 4 | player | The local file index, folder picking and `player:music-files-find` | **Yes** (bridge to native helpers) | 2 |
| 5 | player | Local playback: `cbp-local:`, per-song play ids, the request filter and CSP, the two `<audio>` elements, the timing, the `local` music link, the hardening tests | **Yes** (shell hardening) | 2, 4 |
| 6 | player | The instructor's "music files" state on screen | No (user-visible) | 3, 4 |

Every one of them is rule-sensitive (music handling) and gets a top-tier Reviewer.

### 7. Where the audio may go

The audio of a local file reaches only the room window's `<audio>` elements through
`cbp-local:`. It is never sent to the backend, a live session, the companion or a phone.

### 8. What this changes in earlier ADRs

- **ADR 0003 section 7** gains: a minor version may also add a value to `music.source`; a reader
  that does not know the value lists the class with "This class needs a newer version of the
  player".
- **ADR 0013 section 4**: the mode policy gains the local case. **Section 5**: the request filter
  gains the `cbp-local:` case and the room page's `media-src` gains `cbp-local:`.

## Alternatives

- **Copy the files into an encrypted cache, as for a mix.** Needed for a provider's file, not for
  the instructor's own: it doubles the disk use and adds keys to lose. Rejected for the desktop;
  the phone apps may need a copy and decide that in their own issue.
- **Match by file name or tags.** Breaks when a file is renamed or retagged, and can play the wrong
  song. Rejected for the SHA-256.
- **A major version 2.0 for source `local`.** The backend would convert every stored class up to
  the new major when it serves it, so every older player would then refuse every class, not only
  the local ones. Rejected for the amendment in section 1.
- **Upload the files to our backend.** Breaks rule 3 (no class audio from our server). Rejected.
- **Play what is found and leave gaps.** A class that drops songs at random is worse than the
  manual clock. Rejected for all or nothing.

## Consequences

- Six issues (section 6); two are security-critical.
- classbeat, a separate product, needs its own work to design a class from local files (choosing
  the files in the browser, measuring their length, SHA-256 and beats there) and to send source
  `local`. That is planned in classbeat's repository, not here.
- A class with source `local` plays on any computer where the instructor has the same files; a
  re-encoded or edited file is a different file and is not found.
- The manual clock stays the fallback, as for every source.
