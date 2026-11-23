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

- **Phone and tablet apps** (PL12, owner, 2026-11-15): Android first, as a self-signed APK
  installed by hand, so no store account is needed now. For spike 3, an Android phone or tablet
  with Spotify on it. Before the first APK that studios keep: an Android signing key, made once
  and added as a repository secret (agents never hold it; the runbook will give the commands).
  Losing it means users must uninstall to update. iOS later: an iPhone or iPad and the Apple
  Developer membership above.

## Decisions waiting

- **The phone and tablet apps (plan, section 13, decision 15).** Decided: Android first, as a
  self-signed APK with no store. Open, for later: whether to publish through Google Play; and,
  when iOS starts, whether a music follower on iOS may use Spotify's own iOS SDK (iOS gives no
  app another app's playback). Until then the iOS app runs on the manual clock, and how far an iOS
  build can reach without the App Store is not verified (plan, section 14).
- **One app, two modes (owner, 2026-11-15).** Decided: the Android app has an instructor mode
  and a rider mode. Defaults agents picked (ADR 0011, section 1), which you may change: the mode
  is chosen at sign-in and can be switched in the app; rider mode shows the same rider page
  inside the app, and the web rider page stays; the Spotify music link and notification access
  are instructor mode only; rider mode keeps rules 13 to 15 and gives riders no control.
- **FYI: no burst on an interval change at two energy levels (#590).** At the Beat level, and at
  Tempo only (wherever the energy ramp runs), a drop that falls on an interval change gets no
  burst, and a song with no marked moments gets no light-only burst on its interval changes: the
  ramp, the change frame, the burst's decay and steady light's one change would make 4 changes in
  1 s. They burst at the None level, and a drop away from a change bursts at every level. So
  plan section 3 ("bursts on a drop") and section 4 ("bursts follow the interval changes") hold
  only at the None level and away from a change. Changing it needs the ramp to give way to the
  burst (a spec change), or steady light to stop counting as a change (#592). Say if you want
  either.
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
  FastAPI, PostgreSQL); no phone app of our own, with Bluefy on iPhone for sensors; no external
  hardware such as lighting.

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
- **Spike 3 (Android music follower).** Ready to run on an Android phone or tablet with Spotify:
  the debug APK (CI artifact `android-follower-debug-TEST-BUILD`, kept 3 days after a CI run
  that changes the spike; to be renamed for the two-mode app) or a build of your own following
  `player/spikes/android-follower/README.md`. It is a test build signed with a throwaway debug
  key. Hand back the log file the README names.
- **Spike 2 (scene):** run the scene builds on a studio-class computer with its one screen
  mirrored on the projector, as in the studio (owner, 2026-11-14). The harness gets a one-screen
  mode first (#447).
- **Swedebeat:** whether to ask for an agreement and a source of the audio.
