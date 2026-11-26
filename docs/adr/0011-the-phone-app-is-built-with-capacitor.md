# 0011. The phone and tablet app is built with Capacitor

Status: Proposed. The framework was chosen by the owner (2026-11-15: "ok, go capacitor"); the
rest of this ADR becomes Accepted when a Reviewer passes its pull request.

Amends [ADR 0001](0001-application-stack-music-link-and-timing.md), "Application stack", where it
says "Phones get a web page; there is no phone app of our own": the instructor's player is now
also an installed app on Android, and later iOS (plan section 12, phase PL12; section 13,
decision 15). The rest of ADR 0001 stands. Riders can still use the web pages, with nothing to
install; the app's rider mode (section 1, amended 2026-11-15) is an option, not a requirement.

## Context

The owner wants a studio with no computer, only a tablet or phone and an audio cable, to run a
class with the music followed, as on the desktop (2026-11-15). The web app `/play`
([ADR 0008](0008-the-player-as-a-web-app.md)) already runs on a phone, but only on the manual
clock: a browser cannot read another app's playback. Android lets an installed app read the
system's media sessions, as the Windows follower does. iOS gives no app another app's playback;
iOS waits until the owner has a device (plan, decision 15).

The player is web technology throughout: the room screen (`web/src/room/`), the 3D scene
(`player/scene/`, ADR 0009) and the player core (`player/app/src/core/`: class clock, music-link
state machine, timing). On the desktop, Electron's main process does what the page must not: it
holds the device token in the system keychain (ADR 0002, "The device token"), talks to the
backend, keeps the class cache and runs the music followers.

The candidates were Capacitor (the same web code in the system's web view, native plugins for the
rest), Tauri 2 mobile, Flutter and React Native (plan section 8).

## Decision

### 1. The shell

The installed app is a **Capacitor** app: the player's existing web code runs in the system's web
view (Android System WebView), and what the desktop's main process does is done by **our own
native plugins**, written in Kotlin on Android. One web code base serves the desktop, the website,
`/play` and the app.

**Amended (owner, 2026-11-15): one app, two modes.** The app has two modes, **instructor** and
**rider** (the owner says MOWL's app works the same way). It replaces "The app is the
instructor's player only; it hosts no rider page." What follows are the safest reversible
defaults the Orchestrator picked; the owner may change them (owner.md).

- **The rider page is bundled.** Rider mode runs the rider page's code from the APK, never the
  page the web serves at `/j` (ADR 0007). Section 4 applies unchanged in rider mode: the same
  CSP with `connect-src 'none'`, no remote load, the same plugin allowlist. The web rider page
  stays, so a rider can still join with nothing to install.
- **Rider traffic goes through native code.** The join (`POST /api/live/join`) and the rider's
  socket go through rider-only named intents (section 3), never through the web view.
- **The rider token stays native.** It is held only in native memory for that session: never
  persisted, never given to the web view, and discarded on leave, on a mode switch and when the
  app exits. This differs by design from the web rider page, which keeps it in `sessionStorage`
  (ADR 0007).
- **Native code holds the mode.** The mode is held and enforced in native code. Each mode exposes
  only its own intents (section 3), and the web view cannot select, change or unlock a mode.
- **Rider mode needs no account,** only the join code and a nickname (ADR 0007).
- **The app starts in the last mode used.** The mode is kept in native storage the web view cannot
  reach. The first launch on an unpaired device is in rider mode.
- **Entering instructor mode.** On an unpaired device it starts the pairing of section 5. On a
  paired device, every entry into instructor mode from rider mode first asks for the operating
  system's screen-lock confirmation (the device credential or a biometric), so a restart never
  skips it: the app reopens in rider mode if it was last in rider mode.
- **No screen lock, no instructor mode.** With no secure screen lock set on the device, the app
  does not enter instructor mode on a paired device: it says a screen lock is needed and offers to
  set one. If the device's pairing is lost (for example, the app's data was cleared), the device
  is unpaired and instructor mode needs pairing again.
- **Switching to rider mode.** Native code first stops the music follower, closes any host or
  controller connection, drops all instructor state and reloads the bundled page fresh. Only then
  does the rider page load, so no host event (for example `rider_joined`, which carries other
  riders' nicknames) can reach a web view in rider mode (rule 13).
- **Leaving rider mode** closes the rider socket and discards the rider token.
- The Spotify music link (section 6) and notification access are instructor mode only. Rider mode
  never asks for notification access and never starts the follower.
- Rider mode keeps rules 13 to 15 (plan, section 3): rider data flows one way, to the instructor;
  the join code carries a session identifier only; no team games. It gives a rider no control of
  the class and holds no host or controller token.
- The rule guards of section 8 cover the rider mode's code as they cover the rest of
  `player/mobile/`.

### 2. What runs where

| In the web view (TypeScript, shared with the desktop) | In native code (Kotlin, the app only) |
|---|---|
| The room screen, the 3D scene, the presenter controls | Pairing, the device token and its storage (section 5) |
| The class clock and the music-link state machine (`player/app/src/core/`) | Sync with the backend and the class cache on the device |
| Opening a class the native side returns | The live connection, as transport only (below) |
| What the live session sends and receives, built and checked by the shared TypeScript | The Android music follower (section 6) |
| | Bluetooth sensors (section 7), keep-awake, an external display |

On an external display the app shows only the room view, as the desktop room window does. The
riders' list is never shown there ([ADR 0007](0007-riders-in-a-live-session.md), section 4).

This is more than a thin shell: on the desktop about 1,950 lines of the main process do pairing,
sync and the live host. What moves to Kotlin is the part that holds a secret or needs the
system: pairing, the token, the authenticated requests, the cache and the socket.

**The live session.** The live session's messages stay in the shared TypeScript, so the rule
guards for live sessions (rules 13 and 14) keep covering them. The exceptions are the messages
that carry a host token:

- Native code builds and sends the host's `hello`, and the ender's `hello` and `end`.
- Native code strips the host token from the answer that starts the live session before anything
  reaches the web view.
- The TypeScript builds every other message and never sees the host token. The native socket
  carries those messages as opaque text and adds nothing to them.
- A test checks that no bridge answer or event contains the host token.

### 3. The bridge: named intents only

The web view gets the same kind of interface the desktop's preload gives the renderer: **named
intents** with checked arguments and answers, never a general channel. In particular:

- The web view never passes a URL, path, method, header or host. Each intent maps to one fixed
  backend call chosen in native code, for example "list my classes", "get class *id*", "start the
  live session for class *id*".
- The backend origin is fixed in the native build: HTTPS only in release builds, loopback in a
  debug build, as on the desktop (ADR 0002).
- No answer to the web view ever contains the device token, a pairing device code, a host token,
  a controller token or a rider token. The device code, the host token and the rider token live
  in native memory only.
- **The intents are split by mode (amended 2026-11-15, section 1).** Instructor intents, such as
  the examples above, exist only in instructor mode. Rider mode has its own fixed set, and only
  that set: "join session *code* as *nickname*" (native code calls `POST /api/live/join` and keeps
  the rider token), "send the rider's message" and "receive the rider's messages" over the rider
  socket native code opens with that token, and "leave". The rider's messages are still built and
  checked by the shared TypeScript; native code carries them as opaque text, as for the host.
  *As built (#666):* rider mode has "join", "open", "receive" and "leave". "Send the rider's
  message" is not built: in PL8 a rider sends only its `hello` (ADR 0007). The intent comes with
  the first rider message the web view builds, with its own argument test.
- Every intent has a test that rejects unexpected arguments.

### 4. The web view is locked down

- It loads **only the files bundled in the APK**. Capacitor's `server.url` is never set, there is
  no `allowNavigation` entry, and `cleartext` is off. No remote page, script, style or font is
  ever loaded. Navigation away from the bundle is refused; links meant for a browser open in the
  system browser.
- The Content Security Policy is the desktop room window's, unchanged: `default-src 'none';
  script-src 'self'; style-src 'self'; img-src 'none'; font-src 'self'; connect-src 'none';
  media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none';
  base-uri 'none'; form-action 'none'`.
  - It is widened only as the desktop room window is when the 3D scene mounts there. That widening
    is decided, with a top-tier review, in the desktop pull request that mounts the scene.
  - The app uses the same constant as the desktop, and a test compares the two.
  - `connect-src` stays `'none'`, and no remote source is ever added.
  - Never `unsafe-eval`, and never a script source from outside the bundle.
  - `'wasm-unsafe-eval'` or `blob:` workers are allowed only if that desktop pull request
    justifies them.
- **Plugins: an allowlist, including the core ones.** Only our own plugins are installed.
  Capacitor's Android bridge registers some core plugins by itself (in recent versions
  `CapacitorHttp`, `CapacitorCookies` and `WebView`; the first pull request confirms the list for
  the pinned version). Each of them is disabled or removed at the bridge, so that none is callable
  from the page: `CapacitorHttp` in particular would give page script a network channel outside
  the CSP. A test lists every plugin the bridge registers and fails on any name not on the
  allowlist.
- Release builds are not debuggable, and web view debugging is on only in debug builds. CI checks
  both on the built APK.
- **Permissions: an allowlist.** A test reads the merged manifest and fails on any permission not
  on the list. Never `CAMERA` (rule 12), `RECORD_AUDIO`, or any location permission;
  `BLUETOOTH_SCAN` is declared with `neverForLocation`.
- Backup is off for the app, so neither the token's store nor the class cache leaves the device in
  a backup.

### 5. The device token and sign-in

- Pairing is the desktop's (ADR 0002, pairing): the app shows a code, the instructor approves it
  on the site while signed in with classbeat (ADR 0010). That sign-in happens in the system
  browser or a Custom Tab, never in the app's own web view.
- The device token **never enters the web view's JavaScript**. The native side receives it from
  the pairing poll and stores it encrypted under a key held in the Android Keystore; the key never
  leaves the Keystore. It adds the token only to the fixed calls of section 3.
- If the Keystore cannot hold the key, the app does not pair. There is no plain-text fallback, as
  on the desktop.
- ADR 0002 applies unchanged: the 401 answers and what the app does on each, and the requests
  carry no `Sec-Fetch-Site` header, as the desktop's main process sends none.
- The app can revoke its own token, as the desktop can. Uninstalling the app removes it from the
  device; the instructor removes the device on the site, as for any device.

### 6. Following the music on Android

- One native plugin reads Android's **media sessions** (`MediaSessionManager`). Android grants
  that only to an app with a notification listener the user has enabled in the system settings.
  The app asks for it only when the instructor turns following on, explains why and links to the
  setting. Without it, the app runs on the manual clock.
- **The notification listener is empty.** Its callbacks do nothing, and the app never reads
  notifications (no `getActiveNotifications`, no notification contents). The plugin filters the
  active sessions to Spotify's package before reading anything. A guard test checks the listener's
  source for both.
- It reads **only** Spotify's session: track identity, playing or paused, position and the time
  the position was taken. It never reads audio, never records and keeps nothing it reads beyond the
  class.
- **Transport is ADR 0001's.** Start, pause and next go through Spotify's media session, and only
  when the instructor presses a control (or the companion sends one, ADR 0005). **Start with a
  playlist** (ADR 0001, #486), per this follower: the follower may open the
  `spotify:playlist:<id>` link through Android's link handler and then press play through the media
  session, if spike 3 shows that works. Until then Start behaves as without a playlist and the
  screen says the playlist was not loaded, as on Windows.
- It delivers readings to the shared music-link state machine through the same interface as the
  desktop followers, so lock, re-lock, coasting and undo are the desktop's code. A fake follower
  tests it in CI.

### 7. Bluetooth

Sensors are read through our own plugin with Android's Bluetooth LE API: connect, read, and switch
on measurement notifications. On Android, switching notifications on takes
`setCharacteristicNotification` and **one write: the Client Characteristic Configuration
descriptor (0x2902), with the notification or indication enable value**. That is the only write
the plugin may make. It never calls `writeCharacteristic`, and never writes to the FTMS Control
Point (0x2AD9) or any other characteristic that sets resistance, speed, incline or a brake (rule
2).

### 8. The rule guards cover all of `player/mobile/`

The checks of `player/app/test/unit/rules.test.ts`, `follow-rules.test.ts` and
`transport-rules.test.ts` (no audio playback, no Spotify interfaces, no
equipment control, no stray network use) are extended to all of `player/mobile/`, its TypeScript
and its Kotlin, in the first pull request that adds code there. For Kotlin they also forbid
`MediaPlayer`, ExoPlayer and Media3 players, `AudioTrack`, `AudioRecord` and any Spotify SDK
(rule 3). The Bluetooth check allows exactly the one descriptor write of section 7. These are
only additions; no existing check is loosened.

**Two exceptions, decided by the owner (2026-11-26), each pinned to one file by a test:**

- **Backend calls (#649).** `BackendTransport.kt` may use `HttpsURLConnection`, only to the
  backend origin fixed in the build, with no redirects, a 64 KiB limit on the answer and a 10 s
  timeout. For rider mode (#633), one more file may open a WebSocket to the same fixed origin for
  the rider connection. Every other Kotlin file keeps the full network check.
  As built (#851): the app's own manifest asks for exactly `android.permission.INTERNET`, which
  these calls need on Android (pinned by the rules test). The merged manifest adds only androidx's
  own `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, and `ManifestTest` allows those two and nothing
  else. The web view
  still blocks network loads. No app Kotlin file may loosen certificate or hostname checks, and
  only `MainActivity.kt` constructs the transport.
- **Spotify's media session (#653).** `SpotifySessionReader.kt` may name only the media-session
  types it reads (the session manager, `MediaController`, `MediaMetadata`, `PlaybackState` and its
  `TransportControls`) and the package `com.spotify.music`. Everything else stays banned in that
  file too: audio playback and recording (`MediaPlayer`, `AudioTrack`, `AudioRecord`), players and
  the network. New guards come with it: the notification listener stays empty and never calls
  `getActiveNotifications`, the package filter comes before any read, and there is no Spotify SDK
  and no `spotify:` link.

### 9. Building and signing

- Lane: **player**, under `player/mobile/`. It imports the room screen and the core the way the
  desktop does; the web lane never imports from it. The CI job for it is an infra pull request.
- CI builds a debug APK on Linux for every change to `player/mobile/` and runs the plugins' JVM
  unit tests and the web view's tests with fakes. No test touches the network, a device or a real
  account.
- A release APK is signed with the project's own key, which the owner adds as a repository secret
  (plan, PL12). Agents never hold it. Until it exists, APKs are signed with a throwaway key and are
  published only as test builds (a CI artifact or a pre-release marked as such), never as a
  regular release: Android cannot update an app across signing keys.
- **A temporary project key (owner, 2026-11-26).** The owner has no key yet and asked for one to be
  generated for now and replaced later. One was generated in an agent session and handed to the
  owner, who adds it as repository secrets. Because it passed through an agent session it counts
  as temporary: builds signed with it are test builds as above, and replacing it means users
  uninstall once.
- Releases go to GitHub Releases beside the desktop builds. No store, for now (decision 15).

### 10. Spike 3 comes first

Before the app is built, a throwaway Android follower (`player/spikes/`) logs Spotify's media
session readings against a reference recording on a real phone, with spike 1's pass criteria
(plan section 12). The same spike logs the 3D scene's frame rate in the web view on that phone, at
the scene's lowest quality level. Agents build the spike; running it uses a real phone and a real
Spotify account, so it runs only with the owner's authorization, on the owner's device. If
following fails, the app ships on the manual clock and the rest of this ADR stands. If the 3D scene
is too slow, the app shows the plain 2D screen.

**Amended (owner, 2026-11-24): the app is built before spike 3 runs.** The owner decided not to
wait for the spike 3 run on a phone. The app is built and tested on fakes and in CI; the follower
works as section 6 says, and Start with a playlist stays off until a phone run shows it works. The
owner's run of spike 3 (and then of the app) becomes a later check. If following fails there, the
app falls back to the manual clock as above; if the scene is too slow, it shows the plain 2D
screen. Both fallbacks need no change to the rest of this ADR.

## Alternatives

- **Flutter or React Native:** every screen and the 3D scene would be written again in a second
  stack and kept in step with the web code for good. Rejected.
- **Tauri 2 mobile:** close to Capacitor, but it adds Rust to the project, and its phone support is
  younger. The desktop uses Electron, so Tauri brings no shared shell code. Kept as the
  alternative.
- **A web view that loads the hosted `/play` page:** no bundled code to sign and no offline use,
  and a remote page would reach the native plugins. Rejected.
- **The device token in the web view's storage:** simpler, but any script running in the page
  could read it. Rejected.

## Consequences

- The room screen, the scene, the core and the live-session messages are shared.
- The Kotlin plugins are new code in a new language for the project, each with its own tests.
- Android's web view is updated by the system, not by us, so the scene runs on whatever version
  the phone has. The app states the minimum version it needs.
- Notification access is a broad permission. The app asks for it only when the instructor turns
  following on, keeps working without it, and never reads a notification (section 6).
- The Kotlin side is real work, not a thin wrapper: pairing, sync, the cache and the socket are
  written again for Android, with their own tests.
- iOS follows later with the same web code and its own plugins; following there depends on
  decision 15.
