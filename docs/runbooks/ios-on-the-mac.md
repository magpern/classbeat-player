# Runbook: run the iOS app from Xcode on the Mac

For the owner, on an Apple silicon Mac, from a clean clone. The app is built from Xcode under
your own Apple ID, with no Developer membership (ADR 0016, section 9). CI builds only for the
simulator with signing off; nothing here is signed by an agent or held by CI. No Apple ID, team or
credential is stored in the repository: you sign in to Xcode yourself.

## Needs

- An Apple silicon Mac with macOS.
- Xcode 16.4 (what CI pins; the `ios` job in `.github/workflows/ci.yml` selects
  `/Applications/Xcode_16.4.app`). It ships the iOS 18.5 simulator runtime. Other Xcode versions
  are to be checked on the first run.
- Node 24 (what CI uses; `player/mobile/package.json` asks for 22.18 or later) and npm.
- CocoaPods (`pod`). CI runs `pod install` with the runner's own CocoaPods.

The project does not use the Capacitor CLI. There is no `npx cap sync ios`: the build script
writes the pages straight into the iOS project.

## Steps

```bash
cd player/mobile
npm ci
npm run build            # writes ios/App/App/public/ (and the Android assets)
cd ios/App
pod install              # only Capacitor's own pods, from node_modules
open App.xcworkspace     # the workspace, not App.xcodeproj
```

In Xcode:

1. Pick a simulator in the toolbar. CI uses iPhone 16 on iOS 18.5.
2. Choose the `App` scheme and press Run.
3. Run the build again after any change under `player/mobile/src/`: repeat `npm run build`, then
   Run.

To check the build the way CI does, after an `xcodebuild` run with `IOS_DERIVED_DATA` set to its
derived-data folder, run `npm run ios:verify` in `player/mobile`. It reads the built app's
plists and entitlements and the project against the allowlists, and fails on any finding. The
first run on your Mac may need adjusting; to be checked on the first run.

## Where the CI screenshots are

The `ios` job runs the tests with `-resultBundlePath` and keeps every XCTest attachment named
`ios-<screen>-<state>` as one PNG each, in the workflow artifact `ios-screenshots` (14 days), on the
run's summary page. `scripts/export-xcresult-screenshots.sh` does the export with
`xcrun xcresulttool`; it also runs after a failed test run and never fails the job itself. A run
with no such attachments uploads nothing.

## Your own iPhone, free personal team

Select your iPhone as the run destination, sign in to Xcode with your own Apple ID under Settings,
Accounts, and pick your personal team for the `App` target's Signing. Keep that change on your
Mac and do not commit it. Everything about this is **to be checked on the first run**, including:

- whether the project's bundle identifier and entitlements are accepted by a free personal team;
- how long an install stays valid and what has to be repeated;
- whether Developer Mode and trusting the developer on the phone are needed, and where;
- which of the app's features work under a free team.

Do not rely on any of this until you have reported what you saw.

## What to check and report back

Say for each line: works, does not work, or not tried, and what you saw. Lines marked *later*
need a feature that issues #895 to #898 have not built yet; until they land, report them as
"not built".

- [ ] The app starts in the simulator and shows the start page. On the iPhone, the same.
- [ ] The mode switch between rider and instructor. *Later (#895 to #898).*
- [ ] The screen lock: what the screen does when the phone locks during a class. *Later.*
- [ ] Keep-awake: the screen stays on during a class. *Later.*
- [ ] An external display: connect one by cable or AirPlay and say what appears on it and on the
  phone. *Later.*
- [ ] Bluetooth with a bike or heart-rate sensor, on the iPhone only. Not tested before
  (plan section 14). *Later.*
- [ ] Which Xcode, macOS and iOS versions you used, and any message Xcode or the phone showed.
  Leave out Apple IDs and team names.
