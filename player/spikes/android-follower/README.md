# Spike 3: Android media-session follower and scene frame-rate logger (throwaway)

A small Android app for the owner to install by hand on their own phone. It measures two things
against spike 1's pass criteria (plan section 12; ADR 0011 section 10). It is deleted after spike 3.

1. **Following.** While Spotify plays a class, it reads Spotify's media session and logs each
   reading in spike 1's JSON-lines shape. Spike 1's class clock, link states and pass table are then
   run over that log on a computer (`tools/`).
2. **3D frame rate.** It opens the scene demo (`player/scene/render`, lowest quality level, `q=Low`)
   from files bundled in the APK, in the phone's system web view, and logs frames per second once a
   second for 60 s, with the device model and the web view version.

What it never does: touch the network (the manifest has no `INTERNET` permission, and no camera,
microphone, location or Bluetooth permission either), read or play or record audio, use a Spotify
account, token or SDK, read notifications, or send play, pause, skip or any command to Spotify. It
only reads. Logs stay in the app's own storage until you share them by hand. It is debug-signed only
and is never released.

## How it follows Spotify

Android lets an app read other apps' media sessions only when it has a notification listener that
the user switched on. The app has one (`SpikeListener`), and it is **empty**: its callbacks do
nothing and the app never reads a notification. The reader filters the active sessions to Spotify's
package (`com.spotify.music`) before it reads anything, then reads the track id, title, artist and
length, the playing or paused state, the position and the time that position was taken.
(`tools/` checks all of this in `test/guard.test.ts`.)

## Build the APK

You need JDK 17 or newer, the Android SDK (platform 35 and its build tools; Android Studio brings
both), Node 22 or newer, and a network for the first Gradle and npm downloads.

1. Build the scene demo, which the APK bundles:

   ```
   cd player/scene/render
   npm ci
   npm run build
   ```

2. Tell Gradle where the SDK is (`ANDROID_HOME`, or `sdk.dir=...` in a `local.properties` file in
   this folder; that file is not committed), then in this folder:

   ```
   ./gradlew :app:assembleDebug
   ```

   The APK is `app/build/outputs/apk/debug/app-debug.apk`. It is signed with Gradle's own debug key.
   The build also fails if the merged manifest asks for any permission.

3. Without an Android SDK, `./gradlew :core:test` still builds and tests the plain JVM module (the
   reading-to-log-line mapping, the Spotify filter and the frame-rate summary).

## Install and set up the phone

1. Copy the APK to the phone and open it (allow "install unknown apps" for the app you open it
   from). Or `adb install app/build/outputs/apk/debug/app-debug.apk`.
2. Open "Spike 3 follower". Tap "Open notification access settings", find "Spike 3 follower" and
   switch it on. Come back: the screen says "Notification access: granted."
3. Spotify on the phone, signed in, with the playlist you will play. Keep the phone awake and this
   app in front or just behind Spotify (the app keeps the screen on while it is open).

## Make your class file

Do this on the computer. Copy `../music-follower/example/class.spike.json` and replace the songs
with the ones in your playlist, in order, as spike 1's README says (`trackId` as
`spotify:track:<id>`, `title`, `artist`, `durationMs`, and `crossfadeMs` set to the crossfade the
class was designed for). The phone gives each track's id from Spotify, so the ids match by id.

## Run: following

1. Tap "Start following". The line below shows what the app reads (title, artist, playing or
   paused, position). It shows no class clock: that runs offline.
2. Start the class playlist in Spotify and do spike 1's scenarios (spike 1's README, "The three
   runs" and "Scenarios"). While the app is open:
   - **Mark (m)** at the start of each scenario, **Beat (b)** on clear beats.
   - **Undo (u)** and **Relink (r)** where spike 1's README says to press `u` and `r`. They are
     written to the log as `control` lines and applied by the replay at the time you pressed them.
   - Keep the phone recording the sound (or film the room) as the reference recording.
3. "Stop following" ends the log. Pressing "Share logs" or "Run scene frame rate" also stops it.

Not on the phone: spike 1's number keys that pick the song when the link says Ambiguous. In the
replay a cold start on a repeated song stays Ambiguous until the order settles it.

## Run: frame rate

Tap "Run scene frame rate (60 s, Low)". The scene demo plays for 60 s in a web view at the lowest
quality level and the app logs frames per second once a second. Leave the phone alone while it runs.
It ends with the summary on the screen: median, minimum, the longest run under 30 fps, and whether
the Low level holds (scene.md steps down to the plain 2D screen after 5 s under 30 fps). The first
two seconds are left out of the figures.

## Share the logs

"Share logs" opens Android's share sheet with every log file (one `follow-<time>.jsonl` per
following run, one `scene-fps-<time>.jsonl` per frame-rate run). Send them to yourself by any app
you trust; nothing else leaves the phone. Name the files by hand like spike 1's
(`run-5s-android.jsonl`). The logs hold song titles, artists, positions, clocks, the device model
and the web view version, and nothing with account details.

## Replay the following log

On the computer, in `tools/` (Node 22 or newer):

```
npm ci
npm run replay -- --class my-class.json --log run-5s-android.jsonl --out run-5s-android.replayed.jsonl
```

It feeds the log's readings and your `u` and `r` presses, in order, to spike 1's own class clock
(imported from `../music-follower/src/core`, not ported), prints spike 1's pass table, and writes
`--out`: spike 1's full log, with a `decision` on every reading, ready for any of spike 1's analysis.
`--stale-ms` works as in spike 1.

The table has PASS or FAIL only where the log itself decides (interval timing against the music's
own reading, stale readings applied as current). The other rows print what the log shows, as CHECK,
and the number to set against the reference recording and your marks. Spike 1's README says what to
look at for each scenario.

## What the log holds

Lines are spike 1's: `t: "reading"` with `monoMs` and `wallMs` and the raw `reading` (`trackId`,
`title`, `artist`, `positionMs` at `readAtMs`, `durationMs`, `state`, `polledAtMs`, `source:
"android-media-session"`, `app`); `t: "marker"` (`b`, `m`); `t: "control"` (`undo`, `relink`);
`t: "reader_error"`; `t: "meta"` first and last. Differences from spike 1: the clock is Android's
`elapsedRealtime` (milliseconds since boot, asleep time included); `readAtMs` is the session's
`lastPositionUpdateTime`; there is no `decision` and no class time in the phone's log (the replay
adds them); buffering, connecting and skipping count as paused, and only a running session counts
as playing.

The frame-rate log has `t: "meta"` (model, manufacturer, Android version, web view package and
version, display refresh rate, quality, run length), one `t: "fps"` per second (`fps` from the
page's animation frames; `sceneFps` from the demo's own once-a-second log), and a `t: "fps_summary"`.

## Development

```
./gradlew :core:test                    # the JVM module; no Android SDK needed
cd tools && npm ci && npm run typecheck && npm test
```

`tools/test/guard.test.ts` is the source guard for the hard limits (no permission of any kind, empty
listener, Spotify filter before any read, no transport, no audio class or SDK, no Bluetooth, no
network class or URL, no signing material, a closed list of dependencies). It runs on the real
sources and on a mutation of each limit. It adds to, and does not change,
`player/app/test/unit/rules.test.ts`. The fake log (`tools/test/fixtures/android-fake.jsonl`) is
written by `tools/test/fake_log.ts` in the line shape the Kotlin core writes.

CI does not build this folder yet; a CI job for it is a separate infra issue.
