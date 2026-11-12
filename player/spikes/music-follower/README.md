# Spike 1: music follower (throwaway)

A small command-line tool for the owner to run on a Mac and a Windows PC while Spotify plays a
class. It asks the operating system what Spotify is playing, runs a prototype of the class clock
and link states (plan section 4), and writes a log the spike is judged on (plan section 12, spike 1
table). It is deleted after spike 1.

What it never does: read, record, store or play audio; touch the network; use any Spotify
account, token or API; send play, pause, skip or any other command to Spotify. It only reads.

## Install

1. Spotify desktop app, signed in, with the playlist you will play.
2. Node 22 or newer (`node -v`), from nodejs.org.
3. In this folder:

   ```
   npm ci
   npm run build
   ```

4. Per system:
   - **macOS**: nothing else. The first run asks to let your terminal control Spotify (Automation
     permission); allow it.
   - **Windows**: nothing else (Windows PowerShell 5.1 ships with Windows). Spotify must be the
     desktop app, not a browser tab.
   - **Linux** (best effort): `playerctl` (`sudo apt install playerctl`).

## Make your class file

Copy `example/class.spike.json` and replace the songs with the ones in your playlist, in order:
`trackId` (Spotify: Share, Copy Song Link, the part after `/track/`, written as
`spotify:track:<id>`; optional on Windows, which gives no id), `title`, `artist` and `durationMs`.
Set `crossfadeMs` to the crossfade the class was designed for (9000). Repeat one recording twice
if you want to test the same-recording row. This is a spike-only shape, not the class format.

## Run

```
node dist/cli.js --class my-class.json --out run-xfade-off-mac.jsonl
```

Options: `--rate 4` (polls per second), `--reader auto|macos|windows|linux`, `--stale-ms 2500`.
Keys while it runs: `b` beat tap, `m` mark, `u` undo the last announced resync, `q` quit.
The terminal shows the class time, the link state and the song number.

For the reference recording, film the screen showing the terminal next to the room with a phone,
or just keep the phone recording the sound; tap `b` on a few clear beats and `m` at each scenario
below, so the log and the recording can be lined up afterwards.

## The three runs

Do the whole scenario list in each run, on **each** of the Mac and the Windows PC:

1. Spotify crossfade **off** (Settings, Playback). Class file `crossfadeMs`: 9000.
2. Spotify crossfade **5 s**.
3. Spotify crossfade **9 s**.

Name the files `run-<xfade>-<system>.jsonl`, for example `run-5s-win.jsonl`. Keep the class file
the same in all runs.

## Scenarios (press `m` at the start of each)

Start the tool first, then start the class playlist from song 1.

1. **Play through** at least two song changes without touching anything.
2. **Pause** 20 s, then resume.
3. **Seek** forwards and then backwards inside a song.
4. **Next** and **previous** song.
5. **The same recording twice**: start the class on the repeated song (cold start; the log should
   say Ambiguous), then play on to its second occurrence.
6. **A song that is not in the class** (and an advert if you have the free tier): play it for 20 s, then
   return to the class.
7. **Quit Spotify** for 10 s, start it again and play. (Coasting in, locked out.)
8. **Readings lost while paused**: pause the music, quit Spotify for 30 s, start it again and
   pause at about the same place. Expect the clock to coast, then go back and announce
   "resynced, 30 s back"; press `u` to test the undo. (The exact 30 s case is covered by the unit
   tests with a fake reader; this run shows what a real app does.)
9. **Readings lost while playing**: if you can, play with Spotify minimised to a state where it
   stops answering for about 30 s; otherwise skip (covered by the unit tests).
10. **An hour of play** once per system (a long run, crossfade 9 s).
11. **Beat effects** are measured separately: tap `b` on 30 or more clear beats during a song.

## What to hand back

The `.jsonl` files (six, plus the hour), the phone recordings or a note of what they show, the
class file, and a line per run on anything odd (a song change that looked late, Spotify updated
mid-run, which Windows or macOS version). Do not hand back anything with account details: the
logs contain only song titles, artists, positions and clocks.

## What the log holds

One JSON line per reading: `t: "reading"`, `monoMs` and `wallMs`, the raw `reading` (track,
position at `readAtMs`, state, `polledAtMs`, source) and the follower's `decision` (link state,
class time, song, event, correction, announcement). Markers have `t: "marker"` with the key and the
class time. The first and last lines are `t: "meta"`.

## How the prototype decides (plan section 4)

- Each song owns the window from its start to the next song's start (the class crossfade shortens it).
- Locked: class time is the song's start plus the playback position, never beyond the window's end
  (the clock holds), and never backwards by itself; backward errors under 500 ms are smoothed.
- A reading is current only while its poll is under 2.5 s old; then Coasting. A position is
  extrapolated from its own timestamp (`readAtMs`).
- Coasting and Off the list re-lock to the music in either direction at once; a correction over
  5 s is announced and can be undone (manual clock at the earlier place). Seeks and skips while
  locked are logged as events but not announced (an assumption: the plan's announce rule is read as
  applying to re-locks).
- The same recording twice on a cold start is Ambiguous; mid-class the occurrence nearest the
  clock is chosen (Ambiguous if both are within 10 s of it).
- Matching: track id when the system gives one, otherwise title, artist and length (within 2.5 s).

## Development

```
npm ci && npm test && npm run build     # npm run typecheck also checks the tests
```

Tests use a fake reader and fixtures (`test/fixtures`). The fixtures are synthetic samples written
from the documented output formats of osascript, the Windows media session script and playerctl;
replace or add real captures after the first run on a real machine.
