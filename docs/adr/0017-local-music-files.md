# 0017. Local music files: the instructor's own audio files, played by the player

Status: Proposed. Becomes Accepted when a Reviewer passes its pull request.

## Context

The owner, 2026-11-26: besides Spotify and Swedebeat, a class may use "plain local mp3", the
instructor's own audio files. Classes are still designed in classbeat. This ADR rests on:

- **Plan section 3, rule 3**, amended by the owner on 2026-11-26 in the same pull request as this
  ADR: Spotify's music stays in Spotify's own app; audio from a licensed provider that allows it
  may be played by the player; and **an audio file the instructor keeps on their own device may be
  played by the player. Such a file never leaves that device.** No class audio is ever streamed
  from our server, and music is never chosen, stretched or shifted from a measured cadence.
- **Plan section 4, option E**: when the player plays the audio itself, the position is exact and
  there is no link to lose. ADR 0013 builds that path for a Swedebeat mix: the mode policy, the
  fallback to the manual clock, the main-process protocol handler that serves audio to the room
  window, and the class clock that follows the played position.
- **ADR 0003**: `music.source` is `spotify`, `swedebeat` or `none`, one source per class; each
  song has optional provider `ids`. Format versions are `1.0` to `1.3`.
- **ADR 0001**: each song owns a window of class time; the crossfade the class was designed for is
  `music.design_crossfade_ms`.
- **AGENTS.md section 8**: tests never touch the network or a real account; nothing personal is
  sent where it is not needed.

## Decision

### 1. The class format: source `local` (format 1.4)

A contract pull request adds, in format version `1.4`:

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
  screen offers "Find music files". The main process opens the operating system's own folder
  dialog. The room window and the web page never receive a path and cannot ask for a file by path.
- **Matching.** The main process walks the chosen folder and its subfolders (at most 20 000 files,
  symbolic links not followed), skips any file whose size does not equal a wanted `size_bytes`,
  and hashes the rest. A file matches a song when its SHA-256 equals the song's. Name, tags and
  date are never used to match.
- **Remembering.** Per classbeat-player account, the player keeps a local index `sha256 → (path,
  size, modification time)` in its app data folder, beside the class cache and wiped with it.
  The chosen folders are remembered too, so a new class's files are found without asking again.
- **Checking before playing.** Before a class starts, each song's indexed file is checked: same
  size and modification time as indexed, or else hashed again. A file that changed or went
  missing is dropped from the index and its song counts as missing.
- **What leaves the device: nothing.** The audio, the paths, the folder names, the index and which
  songs were found are never sent to the backend, a live session, a log, a crash report or any
  other process. The backend keeps only the class document as the source sent it.

### 3. Playing

- **All or nothing per class.** A class with source `local` plays its own files only when every
  song's file is found and checked. Otherwise it runs on the manual clock, exactly as a class with
  no music link, and the instructor's screen says which songs are missing (title, artist and file
  name) and offers "Find music files" again. A partial class with silent gaps is never played.
- **The engine.** The songs play in class order in the room window, served by a main-process
  protocol handler like ADR 0013's `cbp-mix:`. The handler answers only for the SHA-256 of a song
  of the class now loaded, reads only the indexed, checked file, and answers with
  `Cache-Control: no-store`. The player copies, converts or caches no audio: the file is read from
  where it is.
- **Timing.** Each song starts at its window's start; consecutive songs overlap by
  `design_crossfade_ms`, with an equal-power crossfade. The class clock follows the played
  position, as for a mix (ADR 0013), so the position is exact. Pause, nudge and skip act on the
  player's own playback. Before playing, the decoded length of each file is compared with the
  song's `length_ms`: more than 1 000 ms apart and that song counts as missing.
- **Errors while playing.** A file that fails to read or decode mid-class makes the class carry on
  on the manual clock from the current position, with a calm notice on the instructor's screen,
  never on the room screen.

### 4. Where it runs

The desktop player first. The phone and tablet apps keep the manual clock for source `local`
until a later issue gives them their own file picking (their file access differs and is not
decided here).

### 5. Guards

- The player's network guard (ADR 0013, issue 3) covers every test of this feature.
- A test plants a known byte pattern in a fake music file, plays a fake class, and checks that no
  request body, log line, live message or stored file outside the index and the picked folder
  holds the pattern or the file's path.
- A test checks that the protocol handler refuses any SHA-256 that is not a song of the loaded
  class, and any request that carries a path.
- Test audio is a generated, licence-free tone file from the test fixtures; no real song is ever
  committed.

## Alternatives

- **Copy the files into an encrypted cache, as for a mix.** Needed for a provider's file, not for
  the instructor's own: it doubles the disk use and adds keys to lose. Rejected for the desktop;
  the phone apps may need a copy and decide that in their own issue.
- **Match by file name or tags.** Breaks when a file is renamed or retagged, and can play the wrong
  song. Rejected for the SHA-256.
- **Upload the files to our backend.** Breaks rule 3 (no class audio from our server). Rejected.
- **Play what is found and leave gaps.** A class that drops songs at random is worse than the
  manual clock. Rejected for all or nothing.

## Consequences

- Issues: the contract (format 1.4 with its rules, generated types and converter fixtures); the
  player's local file index and folder picking; the playback engine and protocol handler; the
  instructor's "music files" state, with a design spec first.
- classbeat, a separate product, needs its own work to design a class from local files (choosing
  the files in the browser, measuring their length, SHA-256 and beats there) and to send source
  `local`. That is planned in classbeat's repository, not here.
- A class with source `local` plays on any computer where the instructor has the same files; a
  re-encoded or edited file is a different file and is not found.
- The manual clock stays the fallback, as for every source.
