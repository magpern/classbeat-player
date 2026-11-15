# 0011. The phone and tablet app is built with Capacitor

Status: Proposed. The framework was chosen by the owner (2026-11-15: "ok, go capacitor"); the
rest of this ADR becomes Accepted when a Reviewer passes its pull request.

Amends [ADR 0001](0001-application-stack-music-link-and-timing.md), "Application stack", where it
says "Phones get a web page; there is no phone app of our own": the instructor's player is now
also an installed app on Android, and later iOS (plan section 12, phase PL12; section 13,
decision 15). The rest of ADR 0001 stands. Riders still use the web pages, with nothing to install.

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
`/play` and the app. The app is the instructor's player only; it hosts no rider page.

### 2. What runs where

| In the web view (TypeScript, shared with the desktop) | In native plugins (Kotlin, the app only) |
|---|---|
| The room screen, the 3D scene, the presenter controls | The device token, in the Android Keystore |
| The class clock and the music-link state machine (`player/app/src/core/`) | Every request that carries the device token, and the live connection |
| Opening a class from the cache the native side returns | The class cache on the device, in the app's own storage |
| | The Android music follower (section 5) |
| | Bluetooth sensors (section 6), keep-awake, an external display |

The web view gets the same narrow, typed interface the desktop's preload gives the renderer: named
calls with checked arguments and answers, never a general channel.

### 3. The web view is locked down

- It loads **only the files bundled in the APK**. Capacitor's `server.url` is never set, and no
  remote page, script, style or font is ever loaded. Navigation away from the bundle is refused.
  Links meant for a browser open in the system browser.
- A Content Security Policy as strict as the desktop room window's: scripts only from the bundle,
  no `unsafe-eval`, no `unsafe-inline` script.
- Only our own plugins are registered. Capacitor's generic plugins that reach the network, files
  or other apps (its HTTP, filesystem, preferences and browser plugins, and any third-party plugin)
  are not installed. A test lists the plugins the app registers and fails on any other.
- Web view debugging is on only in the debug build.

### 4. The device token and sign-in

- Pairing is the desktop's (ADR 0002, pairing): the app shows a code, the instructor approves it
  on the site while signed in with classbeat (ADR 0010). The sign-in itself happens on the site,
  in the system browser, never inside the app's web view.
- The device token **never enters the web view's JavaScript**. The native side receives it from
  the pairing poll, keeps it with the Android Keystore, and adds it to the requests it makes on the
  web view's behalf. The web view sees only results.
- If the Keystore is not available the app does not pair. There is no plain-text fallback, as on
  the desktop.
- The app can revoke its own token, as the desktop can. Uninstalling the app removes it from the
  device; the instructor removes the device on the site, as for any device.

### 5. Following the music on Android

- One native plugin reads Android's **media sessions** (`MediaSessionManager`), which needs the
  user to grant the app notification access in the system settings. The app explains why and
  links to the setting. Without it, the app runs on the manual clock.
- It reads **only** Spotify's session: track identity, playing or paused, position and the time
  the position was taken. It never reads audio, never records, never reads other apps' sessions or
  notifications, and keeps nothing it reads beyond the class.
- It sends play and pause only through the same media session, like the desktop's transport
  control, and only when the instructor presses a control.
- It delivers readings to the shared music-link state machine through the same interface as the
  desktop followers, so lock, re-lock, coasting and undo are the desktop's code. A fake follower
  tests it in CI.

### 6. Bluetooth

Sensors are read through our own plugin with Android's Bluetooth LE API: connect, read, and switch
on measurement notifications. **No write that controls equipment** (no resistance, speed, incline
or brake), as on the desktop. The rule guard that checks this for the desktop is extended to the
plugin's Kotlin source in the same pull request that adds the plugin.

### 7. Building and signing

- Lane: **player**, under `player/mobile/`. It imports the room screen and the core the way the
  desktop does; the web lane never imports from it.
- CI builds a debug APK on Linux for every change to `player/mobile/` and runs the plugins' JVM
  unit tests and the web view's tests with fakes. No test touches the network, a device or a real
  account.
- A release APK is signed with the project's own key, which the owner adds as a repository secret
  (plan, PL12). Agents never hold it. Until it exists, release builds use a throwaway debug key and
  are for testing only.
- Releases go to GitHub Releases beside the desktop builds. No store, for now (decision 15).

### 8. Spike 3 comes first

Before the app is built, a throwaway Android follower (`player/spikes/`) logs Spotify's media
session readings against a reference recording on a real phone, with spike 1's pass criteria
(plan section 12). The same spike logs the 3D scene's frame rate in the web view on that phone, at
the scene's lowest quality level. If following fails, the app ships on the manual clock and the
rest of this ADR stands. If the 3D scene is too slow, the app shows the plain 2D screen.

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

- The room screen, the scene and the core are shared; the app adds only native plugins and a thin
  shell.
- The Kotlin plugins are new code in a new language for the project, each with its own tests.
- Android's web view is updated by the system, not by us, so the scene runs on whatever version
  the phone has. The app states the minimum version it needs.
- Notification access is a broad permission. The app asks for it only when the instructor turns
  following on, and keeps working without it.
- iOS follows later with the same web code and its own plugins; following there depends on
  decision 15.
