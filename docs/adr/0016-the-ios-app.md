# 0016. The iOS app: the same Capacitor app, on the manual clock

Status: Proposed. Becomes Accepted when a Reviewer passes its pull request. Runs on a real iPhone
or iPad, signing and the App Store wait for the owner (docs/owner.md, plan decision 9); until then
everything is built and tested in CI on the iOS simulator and run by the owner on an Apple silicon
Mac.

## Context

Plan phase PL12, amended by the owner on 2026-11-24: "iOS after the Android app is finished",
built and tested in CI on the iOS simulator and run by the owner on an Apple silicon Mac, with
checks on a real iPhone or iPad later. "The same app, with rider mode reading sensors natively,
with the manual clock unless decision 15 clears a follower."

The Android app is done on fakes (Verifier, 2026-11-26, at 27316e5). ADR 0011 describes it: one
Capacitor app with two modes, a locked-down web view, named intents, the device token kept in
native code, a follower through Android's media sessions, Bluetooth notifications only, and rule
guards over all of `player/mobile/`. ADR 0011 says iOS follows "with the same web code and its own
plugins".

Facts that shape iOS:
- iOS gives no app another app's playback, so the Android follower has no iOS equivalent.
  Whether an iOS follower may use Spotify's own iOS SDK is open with the owner (decision 15).
- There is no Apple Developer membership yet (decision 9). Without it, CI can build for the
  simulator only, and nothing can be installed on someone else's device.
- `player/mobile/ios/` does not exist, `@capacitor/ios` is not installed, and CI has no macOS job.

The product rules that bind this work (plan section 3): rule 1 (the player only displays the
class), rule 2 (no equipment control), rule 3 (no Spotify audio), rule 12 (no camera), rules 13
to 15 (rider data flows one way, the join code carries a session identifier only, no team games).

## Decision

### 1. One app, the same web code

The iOS app is the Android app's Capacitor project with its iOS platform added:
`player/mobile/ios/`, `@capacitor/ios` pinned to the same version as `@capacitor/android`. The web
bundle is the one Android uses, unchanged. Native plugins are written in **Swift**, with the same
plugin names and the same named intents as on Android (ADR 0011, section 3), so the TypeScript
bridge in `player/mobile/src/modes/bridge.ts` serves both. Pure rules (`policy/` on Android) get
Swift twins, tested with the same tables.

Every part of ADR 0011 that is not about Android applies unchanged: the two modes and how they
switch (section 1), named intents only and split by mode (section 3), no token in any answer to the
web view (section 3), the rule guards (section 8, extended in section 8 below).

The minimum iOS version is 16, a build setting that can move.

### 2. The web view is locked down

ADR 0011, section 4, carried to WKWebView:
- It loads only the files bundled in the app. `server.url` is never set, there is no
  `allowNavigation` entry, navigation away from the bundle is refused, and links meant for a
  browser open in Safari.
- The same Content Security Policy constant as the desktop and Android, compared by the same test.
- **Plugins: an allowlist, including the core ones.** Capacitor's iOS bridge registers core plugins
  by itself (the first pull request lists them for the pinned version). Each is removed or
  disabled so none is callable from the page; a test fails on any registered name not on the
  allowlist.
- Web view inspection (`isInspectable`) is on only in debug builds; CI checks the release
  configuration.
- **Info.plist and entitlements: an allowlist.** A test reads them and fails on any key not on the
  list. The list names `NSFaceIDUsageDescription` (section 3) and `UIApplicationSceneManifest`
  (section 6) besides Capacitor's own keys. Never a camera, microphone, photo library or location usage key (rule 12). No
  `NSAllowsArbitraryLoads`; App Transport Security allows only HTTPS, with a loopback exception
  in debug builds only. No background modes. No entitlements beyond the default (no iCloud, no app
  groups, no associated domains).

### 3. The device token, pairing and the screen lock

- Pairing is the desktop's and Android's (ADR 0002, ADR 0011 section 5). Sign-in on the site opens
  in Safari, never in the app's web view.
- The device token never enters the web view's JavaScript. It is stored in the **Keychain** as a
  generic password with `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`: not synced to iCloud,
  not restored to another device from a backup, readable only while the device is unlocked, and
  deleted by iOS if the passcode is removed. If the Keychain refuses, the app does not pair; there
  is no plain-text fallback.
- **Uninstalling forgets the pairing.** On iOS, Keychain items outlive an uninstall, so ADR 0011
  section 5's "uninstalling removes it" does not hold by itself. On launch, before anything reads
  the Keychain, the app looks for a first-launch marker in `UserDefaults` (which an uninstall
  deletes). With no marker, it deletes every Keychain item of the app, then writes the marker, and
  starts unpaired and in rider mode. A test covers it: a stored token with no marker is gone after
  launch.
- The mode is held in native code, in storage the web view cannot reach, exactly as on Android.
- **Entering instructor mode on a paired device** asks for the device owner's authentication
  through LocalAuthentication (`deviceOwnerAuthentication`: Face ID, Touch ID or the passcode),
  every time, as ADR 0011 section 1 says. With no passcode set, the app does not enter instructor
  mode and says a passcode is needed. A failed or cancelled check stays in rider mode.
- The class cache is kept in the app's Application Support folder, excluded from backup.

### 4. Backend calls wait for the owner

The guards (ADR 0011, section 8) ban network use in native code. The owner's exception for
Android (#649, 2026-11-26) names one Kotlin file. iOS needs the same exception for one Swift file
(`BackendTransport.swift`, `URLSession` with an ephemeral configuration, the fixed origin, no
redirects, a 64 KiB answer limit, a 10 s timeout, no relaxed certificate or host checks) and for
the rider socket. That is a new guard exception, so it is proposed to the owner (docs/owner.md)
and not built until the owner decides. Until then the iOS app pairs nothing and syncs no classes:
it is built and tested with the native transport faked, and the room screen runs on a bundled
demo class, as Android did before #649.

### 5. The music: the manual clock

The iOS app has **no music follower**. The native follow intent answers `unavailable`, so the
room screen's existing path (`withoutReader`) runs the manual clock, and the room screen does not
offer Follow. If the owner later clears a follower (decision 15), it gets its own ADR. No Swift
code plays, records or reads audio, and none names Spotify (section 8).

### 6. Keep-awake and the external display

- Keep-awake sets `UIApplication.shared.isIdleTimerDisabled` while a class runs in instructor
  mode, under the same pure rule as Android's `KeepAwakePolicy`, and clears it otherwise and
  when the app leaves the foreground.
- **The external display, as Android has it.** When a display is connected (AirPlay or a cable),
  the app shows on it, in a scene with the role `windowExternalDisplayNonInteractive`, a second
  web view that loads only a bundled page, under a Swift twin of Android's `ExternalDisplayPolicy`
  (issue #738) and the lockdown of section 2. That web view has **no bridge** and receives **no
  data**: no class, no token, no rider's reading, in either mode. It never mirrors the phone's
  screen. So, as on Android, the display shows the idle stage while a class runs on the phone.
  Showing the open class there needs a bridge to that web view and is a later decision, as ADR
  0011 left it.

### 7. Bluetooth waits for the sensor decision

Sensors would be read through our own plugin with CoreBluetooth: connect, read, and
`setNotifyValue(true)`. On iOS that call switches notifications on by itself, so the plugin makes
**no write at all**: no `writeValue` on any characteristic or descriptor (rule 2). Like the
Android app's native sensors, it is built only once the owner decides the PL9 sensor guard
proposals (docs/owner.md); until then the app declares no Bluetooth usage key.

### 8. The rule guards cover `player/mobile/ios/`

The checks of ADR 0011 section 8 are extended to all Swift and Objective-C under
`player/mobile/ios/` in the first pull request that adds code there.
- **Imports are an allowlist per file**: `Foundation`, `UIKit`, `WebKit`, `LocalAuthentication`,
  `Security` and `Capacitor`, and for each file only those it needs. Any other import fails, so
  `AVFoundation`, `MediaPlayer`, `AudioToolbox`, `Network`, `Speech`, `CoreBluetooth` (until PL9)
  and any Spotify SDK are out without being listed.
- **Names banned besides the import list**, because some come in through `Foundation` or `UIKit`:
  `AVAudioPlayer`, `AVPlayer`, `AVPlayerLayer`, `AVQueuePlayer`, `AVAudioEngine`,
  `AVAudioRecorder`, `AudioQueue`, `AVCaptureSession`, `AVCaptureDevice`,
  `UIImagePickerController`, `SFSpeechRecognizer`, `MPMusicPlayerController`, `SpotifyiOS`,
  `spotify:` links (rules 3 and 12); `URLSession`, `URLSessionWebSocketTask`, `NWConnection`,
  `CFStream`, `Data(contentsOf:` and `String(contentsOf:` (network, until section 4 is decided);
  `writeValue` (rule 2); and a `WKWebView(` created anywhere but the one factory that applies
  section 2. The Info.plist and
entitlement allowlists of section 2 are guards too. These are only additions; no existing check is
loosened. The Podfile or Swift package list is an allowlist: only Capacitor's own iOS packages.

### 9. Building, testing and signing

- Lane: **player**, under `player/mobile/ios/`. The CI job is an infra pull request.
- CI builds on a pinned macOS runner and Xcode, for the iOS simulator with code signing off
  (`CODE_SIGNING_ALLOWED=NO`), and runs the Swift unit tests (XCTest) on a pinned simulator. The
  job runs only when `player/mobile/` or the code it bundles changes, because macOS minutes cost
  more. No test touches the network, a device or a real account.
- **No signing in CI until decision 9.** There is no Apple Developer membership, so CI makes no
  signed build and Releases carry no iOS build. Agents never hold Apple credentials.
- **The owner's Mac.** The owner opens `player/mobile/ios/` in Xcode on an Apple silicon Mac and
  runs it there under their own Apple ID; a runbook (`docs/runbooks/ios-on-the-mac.md`) gives the
  steps. What runs on a Mac without the membership, and what an iPhone app can do there (external
  displays, Bluetooth), is not verified (plan section 14) and is checked on that run.

## Alternatives

- **A separate native iOS app in SwiftUI.** Rejected: two code bases for the room screen, and the
  rule guards and screens would be duplicated.
- **A follower on iOS now, through Spotify's iOS SDK.** Not decided by agents: it is open with the
  owner (decision 15), and the SDK is banned by rule 3's guard today.
- **Backend calls through the web view on iOS.** Rejected, as in ADR 0011: the token would enter
  JavaScript and `connect-src` would have to open.
- **Waiting for the membership before starting.** Rejected: everything but signing and devices
  can be built and tested in CI now (AGENTS.md section 1, agents never wait for the owner).

## Consequences

- The iOS app is built in this order, one issue each:
  1. The macOS CI job on the simulator (infra lane; not security-critical; it builds an empty
     target until item 2 lands, then runs its tests).
  2. The iOS project, the guards of section 8 and the allowlists of section 2 (player lane;
     security-critical: the shell's hardening; rule-sensitive).
  3. The mode holder, the bridge lockdown and the screen-lock check in Swift (player;
     security-critical).
  4. The Keychain store, the first-launch wipe and pairing, with the transport faked (player;
     security-critical).
  5. Keep-awake and the external display (player; security-critical and rule-sensitive: the
     display's web view and what it may receive).
  6. Rider mode in Swift, with its traffic faked (player; security-critical and rule-sensitive: it
     holds the rider token and carries rider data, rules 13 to 15).
  7. The room screen offers no Follow where the reader is `unavailable`, if it does not already
     (screens lane; a user sees it, so it needs a design review).
  8. The runbook for the owner's Mac (docs).
  The backend transport, the rider socket and Bluetooth follow the owner's decisions.
- The guards grow by a Swift section; nothing in them is loosened.
- macOS CI minutes are spent only on changes to the app.
- Until decision 9, nobody but the owner can run the iOS app, and only from Xcode.
