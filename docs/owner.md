# For the owner

What only the owner can do or decide (AGENTS.md, section 1). Agents add items here and carry on
with other work; nothing in the development loop waits for an answer.

## One-time setup

- **Branch rules on `main`:** require a pull request, the required checks **`ci`** and
  **`pr-title`** (nothing else), squash merges only, no direct pushes, zero required approvals,
  no "branch must be up to date". Agents never change repository settings.
- **Milestones:** the agents' tools cannot create GitHub milestones, so phases are labels
  (`PL0`, …). Create milestones PL0 to PL12 if you want them; agents will use them.
- **A mail service** (before the first deploy): security notices (a paired device, an approved
  source link) are sent by mail (ADR 0002). Instructors sign in through classbeat (ADR 0010), so
  no sign-in mail is sent. Which service, and the sending domain.
- **Signing accounts** (before PL7): an Apple Developer membership and a Windows signing identity.
  On a company-managed Mac that blocks apps from unknown sources, a signed and notarised build is
  enough only if the policy allows apps from identified developers; if it allows only the App
  Store, the company's IT has to make an exception for the app in its device management. Until then the unsigned CI build
  (`classbeat-player-macos-unsigned`) runs only on a Mac that is not managed.
  The player's updater (ADR 0014) also waits for these: until a system's build is signed, the
  player only tells users that a new version exists and never installs one by itself.

- **A treadmill to test on** (PL10, #765): one with FTMS over Bluetooth, for a live check of the
  treadmill reading. Until then PL10 is built and tested on a fake treadmill. Two choices are
  yours, with the defaults agents built (ADR 0015): whether the instructor's computer and the
  app's rider mode may read a treadmill (default: only the rider's own web page reads one), and
  whether riders' running readings may be sent to the instructor (default: no; the live contract
  carries none).

- **Phone and tablet apps** (PL12, owner, 2026-11-15): Android first, as a self-signed APK
  installed by hand, so no store account is needed now. For spike 3, an Android phone or tablet
  with Spotify on it. Before the first APK that studios keep: an Android signing key, made once
  and added as a repository secret (agents never hold it; the runbook will give the commands).
  Losing it means users must uninstall to update. iOS after the Android app (owner, 2026-11-24): the owner's Apple silicon Mac to run
  it; later an iPhone or iPad and the Apple Developer membership above.

- **Let design reviews see the CI screenshots** (2026-11-25). Pick one:
  - Allow a wildcard or unrestricted network for the agents' cloud environment (claude.ai, the
    environment's Settings). This is the simplest.
  - Or say you want CI to publish the screenshots somewhere the agents can reach, and an issue will
    be opened for it.

  Why it is needed: GitHub Actions artifacts are served from a storage host
  (`*.blob.core.windows.net`) whose name changes on every run, and the environment's allowed hosts
  take exact names only, so no fixed entry works (PR #722 review note). Until then the Designer
  gives its verdict from the source, the spec and green CI, and its comment says so.

## Decisions waiting

- **Swedebeat playback (PL11, ADR 0013, 2026-11-24).** Built and tested on a fake source; the
  shipped player has no real source until you answer these:
  - **Where the real audio comes from (plan, section 13, decision 11).** The two routes there: ask
    Swedebeat for an agreement and a source of the audio (recommended), or get the audio through
    the user's MOWL account. Either way the audio goes from the provider straight to the device,
    never through a server of ours. Until you name a source, `UnavailableMixSource` stays the
    default and classes designed with a mix play on the manual clock. Issue 7 (the real source
    client) is not opened until then.
  - **Whether your SwedeBeat gateway has any part in it.** ADR 0013 does not accept it as a route.
    If you propose it, you decide with it how the audio still goes from the provider straight to
    the device, how a player outside your network reaches it, and that it is `https:`.
  - **How long a cached mix may be played offline.** Default agents picked: 90 days since it was
    last played, at most 4 GiB per account, least recently played evicted first. Change either.
- **The looks' sway and the steady-light budget (2026-11-23).** Default agents picked, which you
  may change: the looks' slow sway is not held to the 3 % a second steady-light budget, because
  meeting it in zones 6 and 7 would need the beams at about 1/8 of their light. The sway stays
  inside the flash rule's strict gate and the 30° a second turn limit. Ask if you want flatter
  looks or dimmer beams in the high zones instead.
- **The phone and tablet apps (plan, section 13, decision 15).** Decided: Android first, as a
  self-signed APK with no store. Open, for later: whether to publish through Google Play; and,
  when iOS starts, whether a music follower on iOS may use Spotify's own iOS SDK (iOS gives no
  app another app's playback). Until then the iOS app runs on the manual clock, and how far an iOS
  build can reach without the App Store is not verified (plan, section 14).
- **One app, two modes (owner, 2026-11-15).** Decided: the Android app has an instructor mode
  and a rider mode. Defaults agents picked (ADR 0011, section 1), which you may change: rider
  mode needs no account and runs the rider page bundled in the app, and the web rider page
  stays; the app reopens in the last mode used (rider mode until it is paired); entering
  instructor mode always asks for the phone's screen lock (or starts pairing), and with no screen
  lock set the app stays out of instructor mode; switching to rider mode first ends everything of
  instructor mode; the Spotify music link and notification access are instructor mode only;
  rider mode keeps rules 13 to 15 and gives riders no control.
- **The app's screens: defaults agents picked (#636, 2026-11-24).** You may change any: the app
  does not open from the room's QR code or an App Link, so a rider types the room code; "Follow the
  music" is not on the class list; and a rider's nickname is never remembered (ADR 0007), while FTP
  and maximum heart rate are kept only with "Remember on this phone" and are cleared when the
  rider leaves, the app changes mode, the class ends or the rider is dropped (#633).
- **The phone app's backend calls and the Kotlin network guard (#631, #649, 2026-11-24).** ADR 0011
  (sections 3 and 5) has the app's native code make the fixed backend calls (pairing, the device
  check, the class list and sync) with the device token, because the web view can reach no network.
  The guard added in #637 forbids every network call in the app's Kotlin code, with no exception.
  Agents do not loosen a guard, so this is yours, as the desktop's live connection was (#173).
  Proposal, like option 1 there: one file (`BackendTransport.kt`) may use `HttpsURLConnection`, only
  to the backend address fixed in the build, with no redirects, a 64 KiB answer limit and a 10 s
  timeout; every other file keeps the full check, and a test pins it. Rider mode (#633) needs the
  same for the rider's join call and, in one more file, a WebSocket to the same fixed address for
  the rider connection. Until you decide, the app is built with stand-ins that fail every backend
  call and the rider connection as offline, so pairing and joining show their offline states;
  nothing else waits.
- **The phone app's music follower and the Kotlin audio and Spotify guard (#632, #653, 2026-11-24).**
  ADR 0011 (section 6) has the app follow Spotify by reading its media session (the song and
  whether it plays, never the audio). The guard added in #637 bans every `android.media` and
  `MediaSession` name and the word "spotify" in all the app's Kotlin code, so the reader cannot be
  written without an exception. Proposal, like #173: one file (`SpotifySessionReader.kt`) may name
  only the media-session types it reads (the session manager, `MediaController`, `MediaMetadata`,
  `PlaybackState` and its `TransportControls`) and the package `com.spotify.music`. Everything
  else stays banned in that file too: audio playback and recording (`MediaPlayer`, `AudioTrack`,
  `AudioRecord`), players and the network; every other
  file keeps the full check, and a test pins it. New guards come with it: the notification listener
  stays empty, the package filter comes before any read, and no Spotify SDK or `spotify:` link.
  Until you decide, the app is built with a stand-in reader that reports "unavailable", so the
  phone runs on the manual clock; nothing else waits.
- **Sensors and two rule guards (PL9, ADR 0012, 2026-11-24).** The player's guard bans
  `navigator.bluetooth` in all its code, and the live guard bans `power`, `cadence`, `rpm` and
  `ftms` in every live message, so two parts of PL9 need you. Proposals, like #173: (1) one player
  renderer file may use `navigator.bluetooth`, only for the heart-rate, cycling and fitness-machine
  services (and, from PL10, the Running Speed and Cadence service for foot pods, ADR 0015),
  with no write to any sensor and the app's own device chooser; (2) one live message,
  `rider_reading`, from a rider to the instructor's computer only, with heart rate, cadence and
  power at most once a second, shown in the presenter window only, in join order and never
  ranked, and never stored. With one display (the usual studio), riders' readings would not be
  shown at all. The phone app's native sensors would follow (1). Until you decide, the
  instructor's sensor panel shows "unavailable" and riders' readings stay on their own phones.
  Built now: the rider page reads the rider's own sensor and shows it to that rider only.
- **FYI: no burst on an interval change at two energy levels (#590).** At the Beat level, and at
  Tempo only (wherever the energy ramp runs), a drop that falls on an interval change gets no
  burst, and a song with no marked moments gets no light-only burst on its interval changes: the
  ramp, the change frame, the burst's decay and steady light's one change would make 4 changes in
  1 s. They burst at the None level, and a drop away from a change bursts at every level. So
  plan section 3 ("bursts on a drop") and section 4 ("bursts follow the interval changes") hold
  only at the None level and away from a change. Changing it needs the ramp to give way to the
  burst (a spec change), or steady light to stop counting as a change (#592). Say if you want
  either.
  Two more skips, from #622 (2026-11-24): a light-only burst on an interval change that falls
  inside a beam-turn hold is skipped at every level, because placing it would put 2 changes in
  1 s; and at the Beat and Tempo-only levels a burst is skipped within 1 s of the looks' sway.
- **FYI: the beat dot is gone from the plain 2D screen (#584).** Under the strict flash measure
  it moved a region 12.4 to 14.4 % at 4:3 and 5:4, so the Designer removed it. Riders lose a
  per-beat cue on the 2D screen; the 3D scene keeps its beat lift. Say if you want a cue back.

- **Defaults agents picked that you may want to change** (ADR 0002, once merged, lists them all):
  sign-up by allowlist only; sign-in links work only in the browser that asked for them; no
  local lock on a studio computer shared by several instructors; account deletion removes
  everything, including removal markers and audit events; 8-letter join codes.
- **Decided (owner, 2026-11-13): network calls in web code are allowed.** The owner reversed the
  web lane's network guard ("allow code to communicate"). #253 removed the network and URL checks
  from `web/test/unit/design.test.ts`; it keeps the import check and the font check, and #255 added
  a check that no web CSS or HTML loads a remote font. The website (#144) was then built in #256,
  and the companion page (#174) is being built.
- **The companion's buttons.** Plan section 3 names start, pause, skip and nudge for the
  handlebar companion. ADR 0005 (section 10) adds resume, so a pause from the phone can be ended
  from the phone, and the one-touch undo of a resync that plan section 4 already puts on the
  companion. Agents built it so; plan section 3 is yours to update or to overrule.
- **Decided (owner, 2026-11-13): the player's network guard and the live connection (#173).**
  Option 1: `WebSocket` is allowed in `player/app/src/main/live/live-socket.ts` only, pinned by a
  test in `rules.test.ts` that the owner committed (b4a6657); every other file keeps the full
  check. Built in #200.
- **Resolved (owner, 2026-11-13): the rail texts (#208).** Pushed at the owner's request and
  merged in #251.
- **One screen (owner, 2026-11-13): questions the room-screen spec leaves open.** Agents picked the
  safe default for each; say if you want another.
  - Taking control by code: a control code on the only screen would be seen by every rider, so
    with one display a phone takes control by sign-in only (ADR 0005).
  - End class sends nothing to the music app (the music keeps playing).
  - The undo of a resync is only Ctrl/Cmd+Z when there is no presenter; there is no on-screen notice.
  - Dropping a phone or switching the phone remote off: only End class does it with one display.
  - The phone remote never starts by itself; the room screen has a "Phone remote" button.
  - The controls stay shown before the start and on Class Complete with one display.
  - "Pairing code for app" is read as the riders' join code, shown with a QR that opens the phone
    remote's sign-in page.
- **Riders with one display (Designer, #358).** With one display the room screen has no riders
  control: Remove, Lock joining and New code are in the presenter window only. Say if you want
  them on the room screen.
- The decisions in [plan.md](plan.md), section 13. Decided so far: the backend stack (Python,
  FastAPI, PostgreSQL); installed Android and iOS apps with two modes, Android first (decision
  15, above); riders' sensors from the web page, on iPhone through the installed app's rider mode (Bluefy dropped, 2026-11-24); no external hardware such
  as lighting.

## Tasks only the owner can run

How to set up a Mac for them: [runbooks/owner-mac.md](runbooks/owner-mac.md).

- **Spike 1 (music):** run the follower tool, once it exists, on a Mac and a Windows machine with
  a real Spotify account, and hand back the log file.
- **Music link live checks (PL5 is done on fakes).** With a real Spotify account, on macOS,
  Windows and Linux, run a class while following the music and check:
  - interval timing within 1 s for at least 95% of the class, and never more than 2 s off for
    more than 5 s;
  - crossfade off, 5 s and 9 s: the song change is seen within 1 s and the clock never runs
    backwards;
  - pause, seek, next and previous done in Spotify are followed;
  - the player's transport buttons really reach Spotify;
  - a recording that appears twice in the class (ambiguous) is handled;
  - a song that is not in the class shows "Off the list";
  - quitting and restarting Spotify during a class;
  - Windows timestamps; the 30 s repair path; an hour with no drift;
  - the beat flash is within 50 ms of the beat for at least 90% of beats;
  - the helper process stops when the app quits;
  - Linux without MPRIS shows "following the music is unavailable".
- **Music readers, facts agents could not check:**
  - Windows: Spotify's ids (`Spotify.exe`, `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`) were
    taken from memory; PowerShell with `-InputFormat None` and its 15 s start-up.
  - Linux: `busctl` exists only on systemd systems; a real capture of Spotify's MPRIS
    properties is needed, including whether `Position` moves.
  - macOS: how the Automation permission prompt behaves, and the entitlement a packaged build
    needs.
- **Product call:** when Spotify is paused while a browser plays other music, the player shows
  "Off the list". Say if you want something else.
- **Spike 3 (Android music follower).** No longer blocks PL12 (owner, 2026-11-24): the app is built
  on fakes and the CI emulator, and this run becomes a later check; what it finds becomes new
  issues. Ready to run on an Android phone or tablet with Spotify:
  the debug APK (CI artifact `android-follower-debug-TEST-BUILD`, kept 3 days after a CI run
  that changes the spike; to be renamed for the two-mode app) or a build of your own following
  `player/spikes/android-follower/README.md`. It is a test build signed with a throwaway debug
  key. Hand back the log file the README names.
- **Android 13 and later, "Allow restricted settings".** When the app asks for notification
  access, Android 13+ may first make you allow restricted settings in the app's system page. The
  words on that page differ between phone makers; on your phone, note the exact words and steps
  so the app's help text (docs/design/app-follow.md) can match them.
- **Spike 2 (scene):** run the scene builds on a studio-class computer with its one screen
  mirrored on the projector, as in the studio (owner, 2026-11-14). The harness gets a one-screen
  mode first (#447).
- **Swedebeat:** whether to ask for an agreement and a source of the audio.
